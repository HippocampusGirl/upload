import Debug from "debug";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { makeKey, UploadJob, UploadRequest } from "../client/upload-parts.js";
import { signedUrlOptions } from "../config.js";
import { parseRange } from "../part.js";
import { _Server, _ServerSocket } from "../socket.js";
import { UploadCreateError } from "../utils/errors.js";

const debug = Debug("server");

export class UploadServer {
  io: _Server;

  constructor(io: _Server) {
    this.io = io;
  }

  listen(socket: _ServerSocket) {
    const { controller } = this.io;
    const { s3, bucket, payload } = socket;
    if (payload.t !== "u") {
      throw new Error(
        "Cannot listen with socket.payload, because it is not an upload payload"
      );
    }
    const { n } = payload;

    if (s3 === undefined) {
      throw new Error("Cannot listen on socket without an S3Client");
    }

    const getUploadJob = async (
      uploadRequest: UploadRequest
    ): Promise<UploadJob | UploadCreateError> => {
      parseRange(uploadRequest);

      // Check if already exists
      let success;
      try {
        success = await controller.addFilePart(n, uploadRequest);
      } catch (error) {
        debug(error);
        return { error: "unknown" };
      }
      if (!success) {
        return { error: "upload-exists" };
      }
      const key = makeKey(uploadRequest);

      // Prepare upload jobs
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
        signedUrlOptions
      );
      const uploadJob: UploadJob = {
        ...uploadRequest,
        url,
      };

      return uploadJob;
    };

    socket.on(
      "upload:create",
      async (
        uploadRequests: UploadRequest[],
        callback: (u: (UploadJob | UploadCreateError)[]) => void
      ) => {
        // debug("received %o upload requests", uploadRequests.length);
        const uploadJobs = await Promise.all(uploadRequests.map(getUploadJob));
        debug("sending %o upload jobs", uploadJobs.length);
        callback(uploadJobs);
      }
    );

    socket.on(
      "upload:complete",
      async (
        uploadJob: UploadJob,
        callback: (u: UploadCreateError | undefined) => void
      ): Promise<void> => {
        parseRange(uploadJob);
        // debug("received complete event for upload job %o", uploadJob);
        try {
          await controller.completePart(n, uploadJob);
        } catch (error) {
          debug(error);
          callback({ error: "unknown" });
          return;
        }
        callback(undefined);
      }
    );
    socket.on(
      "upload:checksum",
      async (
        path: string,
        checksumSHA256: string,
        callback: (u: UploadCreateError | undefined) => void
      ): Promise<void> => {
        try {
          await controller.setChecksumSHA256(n, path, checksumSHA256);
        } catch (error) {
          debug(error);
          callback({ error: "unknown" });
          return;
        }
        callback(undefined);
      }
    );
  }
}
