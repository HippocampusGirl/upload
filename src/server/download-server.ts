import Debug from "debug";
import Joi from "joi";

import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { signedUrlOptions } from "../config.js";
import { getInputFromURL, getRangeFromPathname } from "../download-parse.js";
import { ChecksumJob, DownloadFile, DownloadJob } from "../download-schema.js";
import { File, Part } from "../entity.js";
import { _Server, _ServerSocket } from "../socket.js";
import { _BucketObject, listObjects } from "../utils/storage.js";

const debug = Debug("serve");

const checksumMD5Schema = Joi.string().required().hex().length(32);
export class DownloadServer {
  io: _Server;

  isLooping: boolean;

  downloads: Set<string> = new Set();

  constructor(io: _Server) {
    this.io = io;

    this.isLooping = false;
  }

  listen(socket: _ServerSocket) {
    this.startLoop();

    const { s3, controller } = this.io;
    socket.on(
      "download:complete",
      async (downloadJob: DownloadJob, callback: () => void) => {
        const input = getInputFromURL(downloadJob.url);
        await s3.send(new DeleteObjectCommand(input));
        callback();
      }
    );
    socket.on(
      "download:verified",
      async (file: DownloadFile, callback: () => void) => {
        const { bucket, path } = file;
        await controller.setVerified(bucket, path);
        callback();
      }
    );
    socket.on("disconnect", () => {
      this.stopLoop();
    });
  }

  startLoop(): void {
    debug("starting loop");
    this.isLooping = true;

    this.downloads.clear();

    const loop = this.loop.bind(this);
    setTimeout(loop, 1000);
  }
  async loop(): Promise<void> {
    if (!this.isLooping) {
      debug("stopping loop");
      return;
    }

    await this.checkDownloadJobs();

    const loop = this.loop.bind(this);
    setTimeout(loop, 1 * 60 * 1000); // 1 minute
  }
  stopLoop(): void {
    this.isLooping = false;
  }

  async createDownloadJob(
    object: _BucketObject,
    part: Part
  ): Promise<DownloadJob> {
    const input = {
      Bucket: object.Bucket,
      Key: object.Key,
    };
    const url = await getSignedUrl(
      this.io.s3,
      new GetObjectCommand(input),
      signedUrlOptions
    );
    const downloadJob: DownloadJob = {
      bucket: object.Bucket,
      url,
      range: part.range,
      path: part.file.path,
      checksumMD5: part.checksumMD5,
      size: part.file.size!,
    };
    debug("created download job %o", downloadJob);
    return downloadJob;
  }
  async deleteObject(object: _BucketObject): Promise<void> {
    await this.io.s3.send(
      new DeleteObjectCommand({
        Bucket: object.Bucket,
        Key: object.Key,
      })
    );
  }
  async checkDownloadJobs(): Promise<void> {
    debug("checking for new download jobs");

    const { s3, controller } = this.io;

    const checksums: Set<string> = new Set();
    const checkChecksumJob = async (file: File): Promise<void> => {
      const checksumSHA256 = file.checksumSHA256;
      if (checksumSHA256 !== null) {
        if (!checksums.has(checksumSHA256)) {
          await this.submitChecksumJob(file);
          checksums.add(checksumSHA256);
        }
      }
    };

    let downloadJobs: DownloadJob[] = [];
    for await (const object of listObjects(s3)) {
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
          range = getRangeFromPathname(object.Key);
        } catch (error) {
          debug("deleting unknown file %o because the range could not be parsed: %O", object.Key, error);
          await this.deleteObject(object);
          continue;
        }
        if (range.size() !== object.Size) {
          throw new Error(
            "Mismatched size between object and range in file name: " +
            `${object.Size} != ${range.size()}`
          );
        }

        const checksumMD5 = object.ETag.replaceAll("\"", "");
        Joi.assert(checksumMD5, checksumMD5Schema);
        const part = await controller.getPart(checksumMD5, range);
        if (part === null) {
          debug("deleting unknown file %o with checksum %o and range from %o to %o", object.Key, checksumMD5, range.start, range.end);
          await this.deleteObject(object);
          continue;
        }
        const file = part.file;
        if (file.verified) {
          debug("deleting already verified part %o", object.Key);
          await this.deleteObject(object);
          continue;
        }
        checkChecksumJob(file);

        const key = `${object.Bucket}${object.Key}:${range.toString()}`;
        if (this.downloads.has(key)) {
          continue;
        }
        this.downloads.add(key);

        downloadJobs.push(await this.createDownloadJob(object, part));
      } catch (error) {
        debug("could not parse object %o: %O", object, error);
      }

      if (downloadJobs.length > 1000) {
        this.sendDownloadJobs(downloadJobs);
        downloadJobs = [];
      }
    }

    for (const file of await controller.getFilesToVerify()) {
      checkChecksumJob(file);
    }

    this.sendDownloadJobs(downloadJobs);
  }

  private sendDownloadJobs(downloadJobs: DownloadJob[]): void {
    const io = this.io;
    debug("sending %o download jobs", downloadJobs.length);
    io.to("download").emit("download:create", downloadJobs);
  }

  async submitChecksumJob(file: File): Promise<void> {
    const io = this.io;
    const { bucket, path, checksumSHA256 } = file;
    if (checksumSHA256 === null) {
      return;
    }
    const checksumJob: ChecksumJob = {
      bucket,
      path,
      checksumSHA256,
    };
    debug("sending checksum job", checksumJob);
    io.to("download").emit("download:checksum", checksumJob);
  }
}
