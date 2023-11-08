import Debug from "debug";
import { Server, Socket } from "socket.io";
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
import { listObjects } from "./storage.js";
import { UploadJob } from "./upload-parts.js";

const debug = Debug("serve");

interface DownloadRequest extends InfoPart, DownloadFilePart {
  input: GetObjectCommandInput;
}

export class DownloadServer {
  io: Server;

  constructor(io: Server) {
    this.io = io;

    const loop = this.loop.bind(this);
    setInterval(loop, 60 * 1000);
    setTimeout(loop, 1000);
  }

  listen(socket: Socket) {
    const { s3 } = this.io;
    socket.on(
      "download:complete",
      async (downloadJob: DownloadJob, callback: () => void) => {
        const input = getInputFromURL(downloadJob.url);
        await s3.send(new DeleteObjectCommand(input));
        callback();
      }
    );
    socket.on(
      "checksum:complete",
      async (downloadJob: DownloadJob, callback: () => void) => {
        callback();
      }
    );
  }

  async loop() {
    const { s3, uploadServer } = this.io;
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
        const uploadInfo = uploadServer.getUploadInfo(object.Bucket, path);
        if (object.Key.endsWith(UploadInfo.suffix)) {
          this.submitChecksumJob(uploadInfo);
          continue;
        }

        let range;
        try {
          range = getRangeFromPathname(object.Key);
        } catch (error) {
          continue;
        }
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

        this.submitDownloadJob({
          ...part,
          name: getNameFromBucket(object.Bucket),
          path,
          size: await uploadInfo.getSize(),
          input: {
            Bucket: object.Bucket,
            Key: object.Key,
          },
        });
      } catch (error) {
        debug("could not parse object %o: %O", object, error);
      }
    }
  }

  async submitChecksumJob(uploadInfo: UploadInfo): Promise<void> {
    const io = this.io;
    let checksumJob: ChecksumJob;
    try {
      checksumJob = await uploadInfo.getChecksumJob();
    } catch (error) {
      debug("could not submit checksum job: %O", error);
      return;
    }
    debug("sending checksum job", checksumJob);
    io.to("download").emit("download:checksum", checksumJob);
  }
  async submitDownloadJob(u: UploadJob | DownloadRequest): Promise<void> {
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
    debug("sending download job", downloadJob);
    io.to("download").emit("download:create", downloadJob);
  }
}
