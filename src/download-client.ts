import { Command } from "commander";
import Debug from "debug";
import fastq, { queueAsPromised } from "fastq";
import { Request } from "got";
import Joi from "joi";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { FileHandle, open } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join } from "path";

import { requestOptions } from "./config.js";
import { DownloadInfo } from "./download-info.js";
import {
  ChecksumJob,
  DownloadFilePart,
  DownloadJob
} from "./download-schema.js";
import { touch } from "./fs.js";
import { client } from "./http-client.js";
import { parseRange } from "./part.js";
import { Range } from "./range.js";
import { endpointSchema, makeClient } from "./socket-client.js";
import { _ClientSocket } from "./socket.js";

interface CompletedDownloadJob extends DownloadJob {
  size: number;
}

const debug = Debug("download-client");

export const makeDownloadCommand = () => {
  const command = new Command();
  command
    .name(`download`)
    .showHelpAfterError()
    .requiredOption("--endpoint <value>", "Where the server is located")
    .requiredOption("--token <value>", "Token to authenticate with the server")
    .option(
      "--num-threads <count>",
      "Number of concurrent upload threads",
      "20"
    )
    .action(async () => {
      const options = command.opts();

      const endpoint = options.endpoint;
      if (typeof endpoint !== "string") {
        throw new Error(`"endpoint" needs to be a string`);
      }
      Joi.assert(endpoint, endpointSchema);

      const token = options.token;
      if (typeof token !== "string") {
        throw new Error(`"token" needs to be a string`);
      }
      const payload = jwt.decode(token);
      if (typeof payload !== "object" || payload === null) {
        throw new Error(`"token" does not have a payload`);
      }
      const { type } = payload;
      if (type !== "download") {
        throw new Error(`"token" is not a download token`);
      }

      const numThreads = parseInt(options.numThreads, 10);
      if (typeof numThreads !== "number") {
        throw new Error(`"numThreads" needs to be a number`);
      }

      const signal = new Promise<void>((resolve) => {
        process.on("SIGINT", () => {
          resolve();
        });
      });

      const socket = makeClient(endpoint, token);
      const client = new DownloadClient(socket, numThreads);

      try {
        client.listen();
        await signal;
      } finally {
        socket.disconnect();
      }
    });
  return command;
};

const makePath = (job: DownloadFilePart | ChecksumJob): string => {
  return join(job.name, job.path);
};

class DownloadClient {
  socket: _ClientSocket;
  queue: queueAsPromised<DownloadJob, CompletedDownloadJob>;

  downloadInfos: Map<string, DownloadInfo> = new Map();

  constructor(socket: _ClientSocket, numThreads: number) {
    this.socket = socket;
    this.queue = fastq.promise(this, this.runDownloadJob, numThreads);
  }

  getDownloadInfo(path: string): DownloadInfo {
    let downloadInfo = this.downloadInfos.get(path);
    if (downloadInfo === undefined) {
      downloadInfo = new DownloadInfo(path);
      this.downloadInfos.set(path, downloadInfo);
    }
    return downloadInfo;
  }

  listen() {
    this.socket.on("download:create", async (downloadJobs: DownloadJob[]) => {
      for (const downloadJob of downloadJobs) {
        try {
          parseRange(downloadJob);
          debug(
            "received partial download for %s in range %s",
            downloadJob.path,
            downloadJob.range.toString()
          );

          const path = makePath(downloadJob);
          const downloadInfo = this.getDownloadInfo(path);
          const run = await downloadInfo.addDownloadJob(downloadJob);
          if (!run) {
            debug(
              "skipping download job for %s in range %s because it already exists",
              downloadJob.path,
              downloadJob.range.toString()
            );
            await this.socket.emitWithAck("download:complete", downloadJob);
            return;
          }

          await this.queue.push(downloadJob);
        } catch (error) {
          debug("failed to process download job: %o", error);
        }
      }
    });
    this.socket.on("download:checksum", async (checksumJob: ChecksumJob) => {
      try {
        const { checksumSHA256 } = checksumJob;

        const path = makePath(checksumJob);
        const downloadInfo = this.getDownloadInfo(path);
        await downloadInfo.setChecksumSHA256(checksumSHA256);
      } catch (error) {
        debug("failed to process checksum job: %o", error);
      }
    });
  }

  async retryDownloadJob(
    readStream: Request,
    downloadJob: DownloadJob
  ): Promise<CompletedDownloadJob> {
    const { start, end } = downloadJob.range;
    const path = makePath(downloadJob);
    await touch(path);
    let fileHandle: FileHandle | undefined;
    const md5 = createHash("md5");
    let size = 0;
    try {
      fileHandle = await open(path, "r+");
      const writeStream = fileHandle.createWriteStream({ start });
      await pipeline(
        readStream,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            md5.update(chunk);
            size += chunk.length;
            yield chunk;
          }
        },
        writeStream
      );
      writeStream.end();
    } finally {
      await fileHandle?.close();
    }
    if (end !== undefined) {
      if (size !== new Range(start, end).size()) {
        throw new Error(
          `Received invalid response from server: Content length does not match suffix`
        );
      }
    }
    const etag = JSON.parse(readStream.response?.headers.etag ?? "");
    if (typeof etag !== "string") {
      throw new Error(
        `Received invalid response from server: "etag" needs to be a string`
      );
    }
    if (etag !== md5.digest("hex")) {
      throw new Error(
        "Received invalid response from server: " +
          '"etag" does not match MD5 checksum calculated from response body'
      );
    }
    if (downloadJob.checksumMD5 !== etag) {
      throw new Error(
        "Received invalid response from server: " +
          '"etag" does not match MD5 checksum received from server'
      );
    }
    return {
      ...downloadJob,
      size,
    };
  }

  async finalizeDownloadJob(downloadJob: CompletedDownloadJob): Promise<void> {
    const { range } = downloadJob;
    debug(
      "completed partial download for %s in range %s",
      downloadJob.path,
      range.toString()
    );

    const path = makePath(downloadJob);
    const downloadInfo = this.getDownloadInfo(path);
    const verified = await downloadInfo.completePart(downloadJob);

    await this.socket.emitWithAck("download:complete", downloadJob);

    if (verified) {
      await this.socket.emitWithAck("download:verified", downloadJob);
    }
  }

  async runDownloadJob(
    downloadJob: DownloadJob
  ): Promise<CompletedDownloadJob> {
    const { url } = downloadJob;
    const readStream: Request = client.stream.get(url, { ...requestOptions });
    return new Promise((resolve, reject) => {
      const fn = async (retryStream: Request) => {
        try {
          retryStream.once(
            "retry",
            (retryCount: number, error, createRetryStream: () => Request) => {
              fn(createRetryStream());
            }
          );
          let completedDownloadJob = await this.retryDownloadJob(
            retryStream,
            downloadJob
          );
          await this.finalizeDownloadJob(completedDownloadJob);
          resolve(completedDownloadJob);
        } catch (error) {
          debug(error);
        }
      };
      fn(readStream);
    });
  }
}
