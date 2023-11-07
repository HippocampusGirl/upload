import Debug from "debug";
import Joi from "joi";
import { Server, Socket } from "socket.io";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  checksumSuffix,
  delimiter,
  requestOptions,
  signedUrlOptions
} from "./config.js";
import { submitDownloadJob } from "./download-server.js";
import { client } from "./http-client.js";
import { validate } from "./schema.js";
import { makeSuffixes, UploadJob, UploadOptions } from "./upload-parts.js";

const debug = Debug("serve");

export const registerUploadHandlers = (io: Server, socket: Socket) => {
  socket.on("upload:create", async (uploadOptions: UploadOptions, callback) => {
    const bucket = socket.bucket;
    const bucketInput = { Bucket: bucket };

    const { path, ranges } = uploadOptions;
    const suffixes = makeSuffixes(ranges);

    // Prepare upload jobs
    const uploadJobs: UploadJob[] = new Array();
    for (const i in suffixes) {
      const suffix = suffixes[i];
      const range = ranges[i];
      const url = await getSignedUrl(
        io.s3,
        new PutObjectCommand({
          ...bucketInput,
          Key: `${path}${suffix}`,
        }),
        signedUrlOptions
      );
      uploadJobs.push({
        path,
        range,
        url,
      });
    }

    // Send to client
    callback(uploadJobs);
  });

  socket.on("upload:complete", async (uploadJob: UploadJob, callback) => {
    await submitDownloadJob(io, uploadJob.url);
    callback();
  });
  socket.on(
    "upload:checksum",
    async (path: string, checksumSha256: string, callback) => {
      const bucket = socket.bucket;
      const bucketInput = { Bucket: bucket };
      try {
        validate(Joi.string().base64(), checksumSha256);
        const url = await getSignedUrl(
          io.s3,
          new PutObjectCommand({
            ...bucketInput,
            Key: `${path}${delimiter}${checksumSuffix}`,
          })
        );
        await client.put(url, { ...requestOptions, body: checksumSha256 });
        await submitDownloadJob(io, url);
      } catch (error) {
        debug(error);
        throw new Error("Failed to upload checksum");
      }
      callback();
    }
  );
};
