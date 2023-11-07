import Debug from "debug";
import Joi from "joi";
import { Server, Socket } from "socket.io";

import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { signedUrlOptions } from "./config.js";
import {
  ChecksumJob,
  DownloadJob,
  makeChecksumJob,
  makeDownloadOptions
} from "./download-parts.js";
import { validate } from "./schema.js";

const debug = Debug("serve");

export const submitDownloadJob = async (
  io: Server,
  url: string
): Promise<void> => {
  const downloadOptions = makeDownloadOptions(url);
  const { input, name, path } = downloadOptions;

  switch (downloadOptions.type) {
    case "file": {
      const { start, end } = downloadOptions;
      const downloadUrl = await getSignedUrl(
        io.s3,
        new GetObjectCommand(input),
        signedUrlOptions
      );

      const downloadJob: DownloadJob = {
        url: downloadUrl,
        name,
        path,
        start,
        end,
      };
      debug("sending download job", downloadJob);
      io.to("download").emit("download:create", downloadJob);
      break;
    }
    case "checksum": {
      const response = await io.s3.send(new GetObjectCommand(input));
      if (response.Body === undefined) {
        throw new Error(`Invalid response from s3: "Body" is undefined`);
      }
      const checksumSha256 = await response.Body.transformToString();
      validate(Joi.string().base64(), checksumSha256);
      const checksumJob: ChecksumJob = {
        name,
        path,
        checksumSha256,
      };
      debug("sending checksum job", checksumJob);
      io.to("download").emit("download:checksum", checksumJob);
      break;
    }
  }
};

export const registerDownloadHandlers = (io: Server, socket: Socket) => {
  socket.on(
    "download:complete",
    async (downloadJob: DownloadJob, isVerified: boolean, callback) => {
      const { url } = downloadJob;
      const downloadOptions = makeDownloadOptions(url);
      if (downloadOptions.type !== "file") {
        throw new Error(`Invalid download job: ${downloadJob}`);
      }
      await io.s3.send(new DeleteObjectCommand(downloadOptions.input));
      callback();
    }
  );
  socket.on("checksum:complete", async (downloadJob: DownloadJob, callback) => {
    const { url } = downloadJob;
    const downloadOptions = makeChecksumJob(url);
    await io.s3.send(new DeleteObjectCommand(downloadOptions.input));
    callback();
  });
};
