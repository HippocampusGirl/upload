import Debug from "debug";

import { makeKey, UploadJob, UploadRequest } from "../client/upload-parts.js";
import { UploadCreateError } from "../errors.js";
import { parseRange } from "../part.js";
import { _Server, _ServerSocket } from "../socket.js";

const debug = Debug("server");

export class UploadServer {
  io: _Server;

  constructor(io: _Server) {
    this.io = io;
  }

  listen(socket: _ServerSocket) {
    const { controller } = this.io;
    const { storage, bucket, payload } = socket;
    if (payload.t !== "u") {
      throw new Error(
        "Cannot listen with socket.payload, because it is not an upload payload"
      );
    }
    const { n } = payload;

    if (storage === undefined) {
      throw new Error("Cannot listen on socket without storage");
    }

    const getUploadJob = async (
      uploadRequest: UploadRequest
    ): Promise<UploadJob | UploadCreateError> => {
      parseRange(uploadRequest);

      // Check if already exists
      let success;
      try {
        success = await controller.addPart(n, uploadRequest);
      } catch (error) {
        debug("unknown error adding file part: %O", error);
        return { error: "unknown" };
      }
      if (!success) {
        return { error: "upload-exists" };
      }
      const key = makeKey(uploadRequest);

      const url = await storage.getUploadUrl(bucket, key);
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
          await controller.setComplete(n, uploadJob);
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
