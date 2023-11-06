import { UploadJob, UploadOptions } from "parts.js";
import { Server, Socket } from "socket.io";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { signedUrlOptions } from "./config.js";

export const registerUploadHandlers = (io: Server, socket: Socket) => {
  socket.on("upload:create", async (uploadOptions: UploadOptions, callback) => {
    const bucket = socket.bucket;
    const bucketInput = { Bucket: bucket };

    const { path, ranges } = uploadOptions;

    const count = ranges.length;
    const indices = [...Array(count).keys()];

    // Convert to string
    let suffixes: Array<string> = indices.map((i) => `${i}`);
    // Calculate max digits
    const maxDigits = suffixes
      .map((i) => i.length)
      .reduce((a, b) => Math.max(a, b));
    // Zero pad to same length
    suffixes = suffixes.map((i) => `${i.padStart(maxDigits, "0")}`);
    // Add initial dot
    suffixes = suffixes.map((i) => `.${i}`);

    // No need for suffixes if the file is uploaded in one go
    if (suffixes.length === 1) {
      suffixes = [""];
    }

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
    callback();
  });

  socket.on(
    "upload:checksum",
    async (path: string, checksum: string, callback) => {
      const bucket = socket.bucket;
      const bucketInput = { Bucket: bucket };
      try {
        await io.s3.send(
          new PutObjectCommand({
            ...bucketInput,
            Key: `${path}.sha256`,
            Body: checksum,
          })
        );
      } catch (error) {
        console.log(error);
        throw new Error("Failed to upload checksum");
      }
      callback();
    }
  );
};
