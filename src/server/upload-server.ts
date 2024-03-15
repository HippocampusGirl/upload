import Debug from "debug";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { signedUrlOptions } from "../config.js";
import { addFilePart, completePart, setChecksumSHA256 } from "../controller.js";
import { parseRange } from "../part.js";
import { _Server, _ServerSocket } from "../socket.js";
import {
  makeSuffix,
  UploadJob,
  UploadRequest
} from "../upload-client/upload-parts.js";
import { UploadCreateError } from "../utils/errors.js";

const debug = Debug("serve");

export class UploadServer {
  io: _Server;

  constructor(io: _Server) {
    this.io = io;
  }

  listen(socket: _ServerSocket) {
    const { s3, dataSource } = this.io;
    const { bucket } = socket;

    const getUploadJob = async (
      uploadRequest: UploadRequest
    ): Promise<UploadJob | UploadCreateError> => {
      parseRange(uploadRequest);
      const { path } = uploadRequest;

      // Check if already exists
      let success;
      try {
        success = await addFilePart(bucket, uploadRequest, dataSource);
      } catch (error) {
        debug(error);
        return { error: "unknown" };
      }
      if (!success) {
        return { error: "upload-exists" };
      }
      const suffix = makeSuffix(uploadRequest);

      // Prepare upload jobs
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${path}${suffix}`,
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
        debug("received %o upload requests", uploadRequests.length);
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
        try {
          await completePart(bucket, uploadJob, dataSource);
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
          await setChecksumSHA256(bucket, path, checksumSHA256, dataSource);
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
