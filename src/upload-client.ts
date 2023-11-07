import { parse } from "bytes";
import { Command } from "commander";
import Debug from "debug";
import fastq, { queueAsPromised } from "fastq";
import { Request } from "got";
import Joi from "joi";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { FileHandle, open } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Socket } from "socket.io-client";

import { requestOptions } from "./config.js";
import { calculateChecksum } from "./fs.js";
import { client } from "./http-client.js";
import { Range } from "./range.js";
import { makeClient } from "./socket-client.js";
import {
  generateUploadOptions,
  RangeOptions,
  UploadJob
} from "./upload-parts.js";
import { gauge, resetProgress, updateProgress } from "./upload-progress.js";

interface CompletedUploadJob extends UploadJob {}

const debug = Debug("upload-client");

export const makeUploadCommand = () => {
  const command = new Command();
  command
    .name(`upload`)
    .showHelpAfterError()
    .requiredOption("--endpoint <value>", "Where the server is located")
    .requiredOption("--token <value>", "Token to authenticate with the server")
    .requiredOption("--path <value...>", "Path or paths to upload")
    .option(
      "--min-part-size <size>",
      "Minimum size of file parts for concurrent upload",
      "5MB"
    )
    .option("--max-part-count <size>", "Maximum number of file parts", "10000")
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
      Joi.assert(endpoint, Joi.string().uri({ scheme: ["http", "https"] }));

      const token = options.token;
      if (typeof token !== "string") {
        throw new Error(`"token" needs to be a string`);
      }
      const payload = jwt.decode(token);
      if (typeof payload !== "object" || payload === null) {
        throw new Error(`"token" does not have a payload`);
      }
      const { type } = payload;
      if (type !== "upload") {
        throw new Error(`"token" is not an upload token`);
      }

      const paths = options.path;
      if (!Array.isArray(paths)) {
        throw new Error(`"paths" needs to be an array`);
      }

      const minPartSize = parse(options.minPartSize);
      if (!Number.isInteger(minPartSize) || minPartSize === null) {
        throw new Error(`"minPartSize" is not an integer`);
      }
      const maxPartCount = Number(options.maxPartCount);
      if (!Number.isInteger(maxPartCount) || maxPartCount === null) {
        throw new Error(`"maxPartCount" is not an integer`);
      }

      const numThreads = parseInt(options.numThreads, 10);
      if (typeof numThreads !== "number") {
        throw new Error(`"numThreads" needs to be a number`);
      }

      const socket = makeClient(endpoint, token);
      const client = new UploadClient(socket, numThreads);

      try {
        await client.submitPaths(paths, { minPartSize, maxPartCount });
      } finally {
        socket.disconnect();
      }
    });
  return command;
};

class UploadClient {
  socket: Socket;
  queue: queueAsPromised<UploadJob, CompletedUploadJob>;

  constructor(socket: Socket, numThreads: number) {
    this.socket = socket;
    this.queue = fastq.promise(this, this.runUploadJob, numThreads);
  }

  async retryUploadJob(
    writeStream: Request,
    uploadJob: UploadJob
  ): Promise<void> {
    const { path, range } = uploadJob;
    let fileHandle: FileHandle | undefined;
    const md5 = createHash("md5");
    try {
      fileHandle = await open(path);
      const readStream = fileHandle.createReadStream({
        ...range,
        highWaterMark: 512 * 1024, // 512KB
      });
      await pipeline(
        readStream,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            md5.update(chunk);
            gauge.pulse();
            yield chunk;
          }
        },
        writeStream,
        new PassThrough()
      );
    } finally {
      await fileHandle?.close();
    }
    const etag = JSON.parse(writeStream.response?.headers.etag ?? "");
    if (typeof etag !== "string") {
      throw new Error(
        `Received invalid response from server: "etag" needs to be a string`
      );
    }
    if (etag !== md5.digest("hex")) {
      throw new Error(
        `Received invalid response from server: "etag" does not match MD5 checksum`
      );
    }
  }

  async runUploadJob(uploadJob: UploadJob): Promise<CompletedUploadJob> {
    const { start, end } = uploadJob.range;
    uploadJob.range = new Range(start, end);
    const { url, range } = uploadJob;
    const writeStream: Request = client.stream.put(url, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": `${range.size()}`,
      },
      ...requestOptions,
    });
    return new Promise((resolve, reject) => {
      const fn = async (retryStream: Request) => {
        try {
          retryStream.once(
            "retry",
            (retryCount: number, error, createRetryStream: () => Request) => {
              fn(createRetryStream());
            }
          );
          await this.retryUploadJob(retryStream, uploadJob);
          await this.finalizeUploadJob(uploadJob);
          resolve(uploadJob);
        } catch (error) {
          debug(error);
        }
      };
      fn(writeStream);
    });
  }

  async finalizeUploadJob(uploadJob: CompletedUploadJob): Promise<void> {
    updateProgress(uploadJob);
    debug(
      "completed partial upload for %s in range %s",
      uploadJob.path,
      uploadJob.range.toString()
    );
    await this.socket.emitWithAck("upload:complete", uploadJob);
  }

  async submitChecksum(path: string): Promise<void> {
    const checksumSha256 = await calculateChecksum(path);
    await this.socket.emitWithAck("upload:checksum", path, checksumSha256);
  }

  async submitPaths(paths: string[], options: RangeOptions): Promise<void> {
    const uploadJobs: UploadJob[] = new Array();
    for await (const uploadOptions of generateUploadOptions(paths, options)) {
      uploadJobs.push(
        ...(await this.socket.emitWithAck("upload:create", uploadOptions))
      );
    }
    resetProgress(uploadJobs);
    await Promise.all([
      ...uploadJobs.map(this.queue.push),
      ...paths.map(this.submitChecksum, this),
    ]);
  }
}
