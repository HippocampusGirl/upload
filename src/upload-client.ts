import { parse } from "bytes";
import { Command } from "commander";
import Debug from "debug";
import fastq, { queueAsPromised } from "fastq";
import { Request } from "got";
import Joi from "joi";
import jwt from "jsonwebtoken";
import { FileHandle, open } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";

import { requestOptions } from "./config.js";
import { UploadCreateError } from "./errors.js";
import { calculateChecksum } from "./fs.js";
import { client } from "./http-client.js";
import { parseRange } from "./part.js";
import { makeClient } from "./socket-client.js";
import { _ClientSocket } from "./socket.js";
import {
  generateUploadRequests,
  RangeOptions,
  UploadJob,
  UploadRequest
} from "./upload-parts.js";
import { Progress } from "./upload-progress.js";

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
      "16MB"
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
      Joi.assert(
        endpoint,
        Joi.string().uri({ scheme: ["http", "https", "ws", "wss"] })
      );

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
  socket: _ClientSocket;
  queue: queueAsPromised<UploadJob, CompletedUploadJob>;

  progress: Progress = new Progress();

  constructor(socket: _ClientSocket, numThreads: number) {
    this.socket = socket;
    this.queue = fastq.promise(this, this.runUploadJob, numThreads);
  }

  async retryUploadJob(
    writeStream: Request,
    uploadJob: UploadJob
  ): Promise<void> {
    const { progress } = this;
    const { path, range, checksumMD5 } = uploadJob;
    let fileHandle: FileHandle | undefined;
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
            progress.gauge.pulse();
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
    if (etag !== checksumMD5) {
      throw new Error(
        `Received invalid response from server: "etag" does not match MD5 checksum`
      );
    }
  }

  async runUploadJob(uploadJob: UploadJob): Promise<CompletedUploadJob> {
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
          debug(error, retryStream.response);
        }
      };
      fn(writeStream);
    });
  }

  async finalizeUploadJob(uploadJob: CompletedUploadJob): Promise<void> {
    this.progress.completePart(uploadJob);
    // debug(
    //   "completed partial upload for %s in range %s",
    //   uploadJob.path,
    //   uploadJob.range.toString()
    // );
    await this.socket.emitWithAck("upload:complete", uploadJob);
  }

  async submitChecksum(path: string): Promise<void> {
    const checksumSHA256 = await calculateChecksum(path, "sha256");
    await this.socket.emitWithAck("upload:checksum", path, checksumSHA256);
  }

  async submitPaths(paths: string[], options: RangeOptions): Promise<void> {
    let uploadRequests: UploadRequest[] = new Array();

    const createUploadJobs = async (
      uploadRequests: UploadRequest[]
    ): Promise<void> => {
      if (uploadRequests.length === 0) {
        return;
      }
      let results;
      while (true) {
        try {
          results = (await this.socket
            .timeout(5000)
            .emitWithAck("upload:create", uploadRequests)) as (
            | UploadJob
            | UploadCreateError
          )[];
          break;
        } catch (error) {}
      }
      for (const [index, result] of results.entries()) {
        if ("error" in result) {
          const { error } = result;
          const uploadRequest = uploadRequests[index];
          if (error == "upload-exists") {
            this.progress.addPart(uploadRequest);
            this.progress.completePart(uploadRequest);
          } else {
            debug(
              'skipping upload job because "%s" for %s in range %s',
              result.error,
              uploadRequest.path,
              uploadRequest.range.toString()
            );
          }
          continue;
        }
        parseRange(result);
        // debug(
        //   "received partial upload for %s in range %s",
        //   result.path,
        //   result.range.toString()
        // );
        promises.push(this.queue.push(result));
        this.progress.addPart(result);
      }
    };

    const promises: Promise<any>[] = [...paths.map(this.submitChecksum, this)];
    for await (const uploadRequest of generateUploadRequests(paths, options)) {
      uploadRequests.push(uploadRequest);

      if (uploadRequests.length > 100) {
        await createUploadJobs(uploadRequests);
        uploadRequests = new Array();
      }
    }
    await createUploadJobs(uploadRequests);
    await Promise.all(promises);
  }
}
