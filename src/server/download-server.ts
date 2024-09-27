import Joi from "joi";

import EventEmitter, { once } from "node:events";
import { promisify } from "node:util";
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
import { debug } from "./debug.js";

const checksumMD5Schema = Joi.string().required().hex().length(32);

const kConnectedEvent = Symbol("kConnectedEvent");

export class DownloadServer extends EventEmitter {
  io: _Server;
  interval: number;

  sent: Set<string> = new Set();
  completed: Set<string> = new Set();
  checksums: Set<string> = new Set();

  constructor(io: _Server, interval: number) {
    super();

    this.io = io;
    this.interval = interval;

    setImmediate(this.loop.bind(this));
  }

  listen(socket: _ServerSocket) {
    const { controller } = this.io;

    socket.on(
      "download:complete",
      async (
        jobs: DownloadJob[],
        callback: (u: (DownloadCompleteError | null)[]) => void
      ) => {
        const errors = await Promise.all(jobs.map(this.complete, this));

        const ns = new Set(jobs.map((job) => `${job.n}/${job.path}`));
        debug(
          "received complete event for %d download jobs for %s",
          jobs.length,
          [...ns].join("|")
        );

        const count = errors.filter((error) => error !== null).length;
        if (count > 0) {
          debug("failed to set complete for %d download jobs", count);
        }

        callback(errors);
      }
    );
    socket.on(
      "download:verified",
      async (file: DownloadFile, callback: () => void) => {
        debug("received verified event for %O", file);
        const { n, path } = file;
        await controller.setVerified(n, path);
        callback();
      }
    );

    debug("clearing sent downloads and checksums");
    this.sent.clear();
    this.checksums.clear();

    this.emit(kConnectedEvent);
  }

  async loop(): Promise<void> {
    while (true) {
      await Promise.race([
        once(this, kConnectedEvent),
        promisify(setTimeout)(this.interval),
      ]);

      const sockets = await this.io.local.in("download").fetchSockets();
      if (sockets.length > 0) {
        try {
          await this.check();
        } catch (error) {
          debug("error in download server loop: %O", error);
        }
      }
    }
  }

  private async check() {
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

    await Promise.all(storageProviders.map(this.checkDownloadJobs, this));

    for (const file of await controller.getUnverifiedFiles()) {
      const key = `${file.id}:${file.checksumSHA256}`;
      if (this.checksums.has(key)) {
        continue;
      }
      this.checksums.add(key);
      await this.submitChecksumJob(file);
    }
  }

  async checkDownloadJobs(storageProvider: StorageProvider): Promise<void> {
    const { storage } = storageProvider;

    const jobs: DownloadJob[] = [];
    const promises: Promise<void>[] = [];
    for await (const object of storage.listObjects()) {
      promises.push(
        this.checkObject(storageProvider, object)
          .then(async (job: DownloadJob | null) => {
            if (job === null) {
              return;
            }

            jobs.push(job);
            if (jobs.length >= 100) {
              await this.send(jobs.splice(0, jobs.length));
            }
          })
          .catch((error) => debug("could not create download job: %O", error))
      );
    }

    await Promise.all(promises);

    await this.send(jobs);
  }

  private async checkObject(
    storageProvider: StorageProvider,
    object: BucketObject
  ): Promise<DownloadJob | null> {
    const { controller } = this.io;
    const { storage } = storageProvider;

    // try {
    const bucket = object.Bucket;
    const key = object.Key;

    if (bucket === undefined) {
      throw new Error('"object.Bucket" is undefined');
    }
    if (key === undefined) {
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
      range = parse(key);
    } catch (error) {
      debug(
        "deleting unknown file %o because the range could not be parsed: %O",
        key,
        error
      );
      await storage.deleteFile(bucket, key);
      return null;
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
        key,
        checksumMD5,
        toString(range)
      );
      await storage.deleteFile(bucket, key);
      return null;
    }
    const file = part.file;
    if (file.verified === true) {
      debug("deleting part of verified file %o", key);
      await storage.deleteFile(bucket, key);
      return null;
    }

    const { id } = storageProvider;
    const k = [id, bucket, key, toString(range), checksumMD5].join(":");
    if (this.sent.has(k)) {
      return null;
    }
    this.sent.add(k);

    return this.createDownloadJob(storage, object, part);
    // } catch (error) {
    //   debug("could not parse object %o: %O", object, error);
    // }
  }
  private async createDownloadJob(
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
    return downloadJob;
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
    const id = job.storageProviderId;
    const { bucket, range, checksumMD5 } = job;
    const key = makeKey(job);
    const k = [id, bucket, key, toString(range), checksumMD5].join(":");
    if (this.completed.has(k)) {
      return null;
    }

    const { controller } = this.io;
    const storageProvider = await controller.getStorageProvider(
      job.storageProviderId
    );
    if (storageProvider === null) {
      return { error: "unknown-storage-provider" };
    }
    const { storage } = storageProvider;
    try {
      await storage.deleteFile(job.bucket, key);
    } catch (error) {
      debug("could not delete part %o from storage provider: %O", job, error);
      return { error: "unknown" };
    }

    this.completed.add(k);
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
