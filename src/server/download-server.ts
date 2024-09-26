import Debug from "debug";
import Joi from "joi";

import { makeKey } from "../client/upload-parts.js";
import { ChecksumJob, DownloadFile, DownloadJob } from "../download-schema.js";
import { File } from "../entity/file.js";
import { Part } from "../entity/part.js";
import { StorageProvider } from "../entity/storage-provider.js";
import { DownloadCompleteError } from "../errors.js";
import { _Server, _ServerSocket } from "../socket.js";
import { BucketObject, Storage } from "../storage/base.js";
import type { Range } from "../utils/range.js";
import { parse, size, toString } from "../utils/range.js";
const debug = Debug("server");

const checksumMD5Schema = Joi.string().required().hex().length(32);
export class DownloadServer {
  io: _Server;
  isLooping: boolean;
  interval: number;

  downloads: Set<string> = new Set();
  checksums: Set<string> = new Set();

  constructor(io: _Server, interval: number) {
    this.io = io;
    this.isLooping = false;
    this.interval = interval;
  }

  listen(socket: _ServerSocket) {
    this.startLoop();

    const { controller } = this.io;

    socket.on(
      "download:complete",
      async (
        jobs: DownloadJob[],
        callback: (u: (DownloadCompleteError | null)[]) => void
      ) => {
        const errors = await Promise.all(jobs.map(this.complete, this));
        debug("completed %d download jobs", jobs.length);
        callback(errors);
      }
    );
    socket.on(
      "download:verified",
      async (file: DownloadFile, callback: () => void) => {
        const { n, path } = file;
        await controller.setVerified(n, path);
        callback();
      }
    );
    socket.once("disconnect", (reason) => {
      debug("stopping loop after %s", reason);
      this.isLooping = false;
    });
  }

  startLoop(): void {
    if (this.isLooping) {
      return;
    }

    debug("starting loop");
    this.isLooping = true;

    this.downloads.clear();
    this.checksums.clear();

    const loop = this.loop.bind(this);
    setTimeout(loop, 1);
  }
  async loop(): Promise<void> {
    if (!this.isLooping) {
      return;
    }

    const { controller } = this.io;

    debug("checking for new download jobs");
    const storageProviders = [];
    const seen: Set<string> = new Set();
    for (const storageProvider of await controller.getStorageProviders()) {
      if (seen.has(storageProvider.key)) {
        continue;
      }
      seen.add(storageProvider.key);
      storageProviders.push(storageProvider);
    }

    const fileIdSets = await Promise.all(
      storageProviders.map(this.checkDownloadJobs, this)
    );

    const fileIdsForChecksumJobs: Set<number> = new Set();
    for (const fileIdSet of fileIdSets) {
      for (const fileId of fileIdSet) {
        fileIdsForChecksumJobs.add(fileId);
      }
    }

    for (const file of await controller.getUnverifiedFiles()) {
      fileIdsForChecksumJobs.add(file.id);
    }
    // debug("sending %o checksum jobs", fileIdsForChecksumJobs.size);
    for (const fileId of fileIdsForChecksumJobs) {
      const file = await controller.getFileById(fileId);
      if (file === null) {
        throw new Error(`File not found for id ${fileId}`);
      }
      const key = `${fileId}:${file.checksumSHA256}`;
      if (this.checksums.has(key)) {
        continue;
      }
      this.checksums.add(key);
      await this.submitChecksumJob(file);
    }

    const loop = this.loop.bind(this);
    setTimeout(loop, this.interval);
  }

  async createDownloadJob(
    storage: Storage,
    object: BucketObject,
    part: Part
  ): Promise<DownloadJob> {
    if (object.Key === undefined) {
      throw new Error('"object.Key" is undefined');
    }
    const { start, end } = part;
    const range = { start, end };
    const downloadJob: DownloadJob = {
      n: part.file.n,
      storageProviderId: storage.storageProvider.id,
      bucket: object.Bucket,
      url: await storage.getDownloadUrl(object.Bucket, object.Key),
      range,
      path: part.file.path,
      checksumMD5: part.checksumMD5,
      size: part.file.size!,
    };
    // debug("created download job %o", downloadJob);
    return downloadJob;
  }
  async checkDownloadJobs(
    storageProvider: StorageProvider
  ): Promise<Set<number>> {
    const { controller } = this.io;
    const { storage } = storageProvider;

    let fileIdsForChecksumJobs: Set<number> = new Set();
    let downloadJobs: DownloadJob[] = [];

    let count: number = 16;
    let promise: Promise<any> | null = null;
    for await (const object of storage.listObjects()) {
      try {
        if (object.Bucket === undefined) {
          throw new Error('"object.Bucket" is undefined');
        }
        if (object.Key === undefined) {
          throw new Error('"object.Key" is undefined');
        }
        if (object.Size === undefined) {
          throw new Error('"size" is undefined');
        }
        if (object.ETag === undefined) {
          throw new Error('"object.ETag" is undefined');
        }

        let range: Range;
        try {
          range = parse(object.Key);
        } catch (error) {
          debug(
            "deleting unknown file %o because the range could not be parsed: %O",
            object.Key,
            error
          );
          await storage.deleteFile(object.Bucket, object.Key);
          continue;
        }
        if (size(range) !== object.Size) {
          throw new Error(
            "Mismatched size between object and range in file name: " +
              `${object.Size} != ${size(range)}`
          );
        }

        const checksumMD5 = object.ETag.replaceAll('"', "");
        Joi.assert(checksumMD5, checksumMD5Schema);
        const part = await controller.getPart(checksumMD5, range);
        if (part === null) {
          debug(
            "deleting unknown file %o with checksum %o and range %o",
            object.Key,
            checksumMD5,
            toString(range)
          );
          await storage.deleteFile(object.Bucket, object.Key);
          continue;
        }
        const file = part.file;
        if (file.verified === true) {
          debug("deleting part of verified file %o", object.Key);
          await storage.deleteFile(object.Bucket, object.Key);
          continue;
        }

        const key = [
          storageProvider.id,
          object.Bucket,
          object.Key,
          range.toString(),
          checksumMD5,
        ].join(":");
        if (this.downloads.has(key)) {
          // debug("already downloading file %o", object.Key);
          continue;
        }
        this.downloads.add(key);

        fileIdsForChecksumJobs.add(file.id);
        downloadJobs.push(await this.createDownloadJob(storage, object, part));
      } catch (error) {
        debug("could not parse object %o: %O", object, error);
      }

      if (downloadJobs.length >= count) {
        if (promise !== null) {
          await promise;
        }
        promise = this.send(downloadJobs);
        downloadJobs = [];
        count *= 2;
      }
    }

    if (promise !== null) {
      await promise;
    }
    await this.send(downloadJobs);

    return fileIdsForChecksumJobs;
  }

  private async send(jobs: DownloadJob[]): Promise<void> {
    if (jobs.length === 0) {
      return;
    }

    const ns = [...new Set(jobs.map((job) => job.n))].join("|");
    debug("sending %d download jobs for %s", jobs.length, ns);
    try {
      await this.io
        .to("download")
        .timeout(60 * 1000)
        .emitWithAck("download:create", jobs);
    } catch (error) {
      debug("timeout for download jobs");
    }
  }
  private async complete(
    job: DownloadJob
  ): Promise<DownloadCompleteError | null> {
    const { controller } = this.io;
    const storageProvider = await controller.getStorageProvider(
      job.storageProviderId
    );
    if (storageProvider === null) {
      return { error: "unknown-storage-provider" };
    }
    const { storage } = storageProvider;
    try {
      await storage.deleteFile(job.bucket, makeKey(job));
    } catch (error) {
      debug("could not delete part %o from storage provider: %O", job, error);
      return { error: "unknown" };
    }
    return null;
  }

  async submitChecksumJob(file: File): Promise<void> {
    const io = this.io;
    const { n, path, checksumSHA256 } = file;
    if (checksumSHA256 === null) {
      return;
    }
    const checksumJob: ChecksumJob = {
      n,
      path,
      checksumSHA256,
    };
    debug("sending checksum job for %s/%s (%s)", n, path, checksumSHA256);
    io.to("download").emit("download:checksum", checksumJob);
  }
}
