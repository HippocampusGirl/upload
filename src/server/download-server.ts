import Debug from "debug";
import Joi from "joi";

import { makeKey } from "../client/upload-parts.js";
import { ChecksumJob, DownloadFile, DownloadJob } from "../download-schema.js";
import { File } from "../entity/file.js";
import { Part } from "../entity/part.js";
import { StorageProvider } from "../entity/storage-provider.js";
import { DownloadCompleteError } from "../errors.js";
import { parseRange } from "../part.js";
import { _Server, _ServerSocket } from "../socket.js";
import { BucketObject, Storage } from "../storage/base.js";
import { Range } from "../utils/range.js";

const debug = Debug("server");

const checksumMD5Schema = Joi.string().required().hex().length(32);
export class DownloadServer {
  io: _Server;
  isLooping: boolean;
  interval: number;

  downloads: Set<string> = new Set();
  checksums: Set<number> = new Set();

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
        downloadJob: DownloadJob,
        callback: (u: DownloadCompleteError | undefined) => void
      ) => {
        parseRange(downloadJob);

        const storageProvider = await controller.getStorageProvider(
          downloadJob.storageProviderId
        );
        if (storageProvider === null) {
          callback({ error: "unknown-storage-provider" });
          return;
        }
        const { storage } = storageProvider;
        try {
          await storage.deleteFile(downloadJob.bucket, makeKey(downloadJob));
        } catch (error) {
          debug(
            "could not delete part %o from storage provider: %O",
            downloadJob,
            error
          );
          callback({ error: "unknown" });
        }
        // debug("download complete %o", downloadJob);
        callback(undefined);
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
    socket.on("disconnect", () => {
      this.stopLoop();
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
      debug("stopping loop");
      return;
    }

    debug("checking for new download jobs");
    const storageProviders = [];
    const seen: Set<string> = new Set();
    for (const storageProvider of await this.io.controller.getStorageProviders()) {
      if (seen.has(storageProvider.key)) {
        continue;
      }
      seen.add(storageProvider.key);
      storageProviders.push(storageProvider);
    }
    await Promise.all(storageProviders.map(this.checkDownloadJobs, this));

    const loop = this.loop.bind(this);
    setTimeout(loop, this.interval);
  }
  stopLoop(): void {
    this.isLooping = false;
  }

  async createDownloadJob(
    storage: Storage,
    object: BucketObject,
    part: Part
  ): Promise<DownloadJob> {
    if (object.Key === undefined) {
      throw new Error('"object.Key" is undefined');
    }
    const downloadJob: DownloadJob = {
      n: part.file.n,
      storageProviderId: storage.storageProvider.id,
      bucket: object.Bucket,
      url: await storage.getDownloadUrl(object.Bucket, object.Key),
      range: part.range,
      path: part.file.path,
      checksumMD5: part.checksumMD5,
      size: part.file.size!,
    };
    debug("created download job %o", downloadJob);
    return downloadJob;
  }
  async checkDownloadJobs(storageProvider: StorageProvider): Promise<void> {
    const { controller } = this.io;
    const { storage } = storageProvider;

    let fileIdsForChecksumJobs: Set<number> = new Set();
    let downloadJobs: DownloadJob[] = [];

    let chunkSize: number = 16;
    for await (const object of storage.listObjects()) {
      if (!this.isLooping) {
        return;
      }
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

        let range;
        try {
          range = Range.parse(object.Key);
        } catch (error) {
          debug(
            "deleting unknown file %o because the range could not be parsed: %O",
            object.Key,
            error
          );
          await storage.deleteFile(object.Bucket, object.Key);
          continue;
        }
        if (range.size() !== object.Size) {
          throw new Error(
            "Mismatched size between object and range in file name: " +
              `${object.Size} != ${range.size()}`
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
            range.toString()
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

      if (downloadJobs.length >= chunkSize) {
        await this.sendDownloadJobs(downloadJobs);
        downloadJobs = [];
        chunkSize *= 2;
      }
    }

    await this.sendDownloadJobs(downloadJobs);

    for (const file of await controller.getUnverifiedFiles()) {
      fileIdsForChecksumJobs.add(file.id);
    }
    // debug("sending %o checksum jobs", fileIdsForChecksumJobs.size);
    for (const fileId of fileIdsForChecksumJobs) {
      const file = await controller.getFileById(fileId);
      if (file === null) {
        throw new Error(`File not found for id ${fileId}`);
      }
      await this.submitChecksumJob(file);
    }
  }

  private async sendDownloadJobs(downloadJobs: DownloadJob[]): Promise<void> {
    // debug("sending %o download jobs", downloadJobs.length);
    try {
      await this.io
        .to("download")
        .timeout(10 * 1000)
        .emitWithAck("download:create", downloadJobs);
    } catch (error) {
      debug("timeout for download jobs: %O", error);
    }
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
    debug("sending checksum job", checksumJob);
    io.to("download").emit("download:checksum", checksumJob);
  }
}
