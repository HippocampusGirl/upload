import Debug from "debug";
import { UploadInfo } from "upload-info.js";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectCommandInput
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { signedUrlOptions } from "./config.js";
import {
  getInputFromURL,
  getNameFromBucket,
  getNameFromURL,
  getPathFromPathname,
  getPathFromURL,
  getRangeFromPathname,
  getRangeFromURL
} from "./download-parse.js";
import {
  ChecksumJob,
  DownloadFilePart,
  DownloadJob
} from "./download-schema.js";
import { InfoPart } from "./info.js";
import { _Server, _ServerSocket } from "./socket.js";
import { listObjects } from "./storage.js";
import { UploadJob } from "./upload-parts.js";

const debug = Debug("serve");

interface DownloadRequest extends InfoPart, DownloadFilePart {
  input: GetObjectCommandInput;
}

export class DownloadServer {
  io: _Server;

  constructor(io: _Server) {
    this.io = io;

    const loop = this.loop.bind(this);
    setTimeout(loop, 1000);
  }

  listen(socket: _ServerSocket) {
    const { uploadServer, s3 } = this.io;
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
      async (downloadJob: DownloadJob, callback: () => void) => {
        const input = getInputFromURL(downloadJob.url);
        if (input.Bucket === undefined) {
          throw new Error('"input.Bucket" is undefined');
        }

        const { path } = downloadJob;
        const pathFromURL = getPathFromURL(downloadJob.url);
        if (path !== pathFromURL) {
          throw new Error(
            `Mismatched path between job and upload URL: ` +
              `${path} != ${pathFromURL}`
          );
        }

        const uploadInfo = uploadServer.getUploadInfo(input.Bucket, path);
        await uploadInfo.setVerified();
        callback();
      }
    );
  }

  async loop() {
    debug("loop");

    const io = this.io;
    const { s3, uploadServer } = io;

    let downloadJobs: DownloadJob[] = new Array();
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

        const path = getPathFromPathname(object.Key);
        // debug("found path %o", path);
        const uploadInfo = uploadServer.getUploadInfo(object.Bucket, path);
        if (await uploadInfo.isVerified()) {
          continue;
        }
        if (object.Key.endsWith(UploadInfo.suffix)) {
          await this.submitChecksumJob(uploadInfo);
          continue;
        }

        // debug("found download %o", path);
        let range;
        try {
          range = getRangeFromPathname(object.Key);
        } catch (error) {
          continue;
        }
        // debug("found range %o for %o", range, path);
        if (range.size() !== object.Size) {
          throw new Error(
            "Mismatched size between object and range in file name: " +
              `${object.Size} != ${range.size()}`
          );
        }
        const part = await uploadInfo.getPart({
          range,
          checksumMD5: object.ETag,
        });

        downloadJobs.push(
          await this.createDownloadJob({
            ...part,
            name: getNameFromBucket(object.Bucket),
            path,
            size: await uploadInfo.getSize(),
            input: {
              Bucket: object.Bucket,
              Key: object.Key,
            },
          })
        );
      } catch (error) {
        debug("could not parse object %o: %O", object, error);
      }

      if (downloadJobs.length > 1000) {
        this.sendDownloadJobs(downloadJobs);
        downloadJobs = new Array();
      }
    }
    this.sendDownloadJobs(downloadJobs);

    const loop = this.loop.bind(this);
    setTimeout(loop, 60 * 1000);
  }

  private sendDownloadJobs(downloadJobs: DownloadJob[]): void {
    const io = this.io;
    debug("sending %o download jobs", downloadJobs.length);
    io.to("download").emit("download:create", downloadJobs);
  }

  async submitChecksumJob(uploadInfo: UploadInfo): Promise<void> {
    const io = this.io;
    let checksumJob: ChecksumJob;
    try {
      checksumJob = await uploadInfo.getChecksumJob();
    } catch (error) {
      return;
    }
    debug("sending checksum job", checksumJob);
    io.to("download").emit("download:checksum", checksumJob);
  }
  async createDownloadJob(
    u: UploadJob | DownloadRequest
  ): Promise<DownloadJob> {
    const io = this.io;
    const { range, path, checksumMD5, size } = u;

    let input, name;
    if ("url" in u) {
      name = getNameFromURL(u.url);

      const rangeFromURL = getRangeFromURL(u.url);
      if (!range.equals(rangeFromURL)) {
        throw new Error(
          `Mismatched range between job and upload URL: ` +
            `${range.toString()} != ${rangeFromURL.toString()}`
        );
      }

      const pathFromURL = getPathFromURL(u.url);
      if (path !== pathFromURL) {
        throw new Error(
          `Mismatched path between job and upload URL: ` +
            `${path} != ${pathFromURL}`
        );
      }

      input = getInputFromURL(u.url);
    } else {
      name = u.name;
      input = u.input;
    }

    const url = await getSignedUrl(
      io.s3,
      new GetObjectCommand(input),
      signedUrlOptions
    );
    const downloadJob: DownloadJob = {
      name,
      url,
      range,
      path,
      checksumMD5,
      size,
    };
    // debug("created download job %o", downloadJob);
    return downloadJob;
  }
}
