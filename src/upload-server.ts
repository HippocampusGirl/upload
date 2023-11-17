import Debug from "debug";
import { Server, Socket } from "socket.io";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { signedUrlOptions } from "./config.ts";
import { UploadCreateError } from "./errors.ts";
import { parseRange } from "./part.ts";
import { _Server, _ServerSocket } from "./socket.ts";
import { UploadInfo } from "./upload-info.ts";
import { makeSuffix, UploadJob, UploadRequest } from "./upload-parts.ts";

const debug = Debug("serve");

export class UploadServer {
  io: _Server;

  uploadInfos: Map<string, UploadInfo> = new Map();

  constructor(io: _Server) {
    this.io = io;
  }

  getUploadInfo(bucket: string, path: string): UploadInfo {
    const key = `${bucket}/${path}`;

    let uploadInfo = this.uploadInfos.get(key);
    if (uploadInfo === undefined) {
      uploadInfo = new UploadInfo(bucket, path, this.io.s3);
      this.uploadInfos.set(key, uploadInfo);
    }
    return uploadInfo;
  }

  listen(socket: _ServerSocket) {
    const { downloadServer } = this.io;
    const { bucket } = socket;

    const getUploadJob = async (
      uploadRequest: UploadRequest
    ): Promise<UploadJob | UploadCreateError> => {
      const { s3 } = this.io;

      parseRange(uploadRequest);
      const { path } = uploadRequest;

      // Check if already exists
      const uploadInfo = this.getUploadInfo(bucket, path);
      let success;
      try {
        success = await uploadInfo.addUploadRequest(uploadRequest);
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

      debug("sending upload job %o", uploadJob);
      return uploadJob;
    };
    socket.on(
      "upload:create",
      async (
        uploadRequests: UploadRequest[],
        callback: (u: (UploadJob | UploadCreateError)[]) => void
      ) => {
        callback(await Promise.all(uploadRequests.map(getUploadJob)));
      }
    );

    socket.on(
      "upload:complete",
      async (
        uploadJob: UploadJob,
        callback: (u: UploadCreateError | undefined) => void
      ): Promise<void> => {
        parseRange(uploadJob);
        const { path } = uploadJob;
        const uploadInfo = this.getUploadInfo(bucket, path);
        try {
          await uploadInfo.completePart(uploadJob);
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
        const uploadInfo = this.getUploadInfo(bucket, path);
        try {
          await uploadInfo.setChecksumSHA256(checksumSHA256);
        } catch (error) {
          debug(error);
          callback({ error: "unknown" });
          return;
        }
        await downloadServer.submitChecksumJob(uploadInfo);
        callback(undefined);
      }
    );
  }
}
