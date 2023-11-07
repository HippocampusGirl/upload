import { Server, Socket } from "socket.io";

import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { signedUrlOptions } from "./config.js";
import { DownloadJob, makeDownloadOptions } from "./download-parts.js";
import { UploadJob } from "./upload-parts.js";

const submitDownloadJob = async (io: Server, url: string): Promise<void> => {
  const downloadOptions = makeDownloadOptions(url);

  switch (downloadOptions.type) {
    case "file": {
      const { input, name, path, start, end } = downloadOptions;
      const downloadUrl = await getSignedUrl(
        io.s3,
        new GetObjectCommand(input),
        signedUrlOptions
      );

      console.log("downloadUrl", downloadUrl);
      const downloadJob: DownloadJob = {
        url: downloadUrl,
        name,
        path,
        start,
        end,
      };
      io.to("download").emit("download:create", downloadJob);
    }
    case "checksum": {
      // TODO
    }
  }
};

export const registerDownloadHandlers = (io: Server, socket: Socket) => {
  socket.on("upload:complete", async (uploadJob: UploadJob, callback) => {
    await submitDownloadJob(io, uploadJob.url);
    callback();
  });
  socket.on("download:complete", async (downloadJob: DownloadJob, callback) => {
    const { url } = downloadJob;
    const downloadOptions = makeDownloadOptions(url);
    if (downloadOptions.type !== "file") {
      throw new Error(`Invalid download job: ${downloadJob}`);
    }
    await io.s3.send(new DeleteObjectCommand(downloadOptions.input));
    callback();
  });
};
