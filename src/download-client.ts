import { Command } from "commander";
import Debug from "debug";
import fastq, { queueAsPromised } from "fastq";
import { Request } from "got";
import Joi from "joi";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { FileHandle, mkdir, open } from "node:fs/promises";
import { parse } from "node:path";
import { pipeline } from "node:stream/promises";
import { join } from "path";
import { Socket } from "socket.io-client";

import { DownloadFileBase, DownloadJob } from "./download-parts.js";
import { client } from "./http-client.js";
import { makeClient } from "./socket-client.js";
import { Range } from "./upload-parts.js";

interface CompletedDownloadJob extends DownloadJob {}

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

class DownloadClient {
  socket: Socket;
  queue: queueAsPromised<DownloadJob, CompletedDownloadJob>;

  constructor(socket: Socket, numThreads: number) {
    this.socket = socket;
    this.queue = fastq.promise(this, this.runDownloadJob, numThreads);
  }

  listen() {
    this.socket.on("download:create", async (downloadJob: DownloadJob) => {
      try {
        await this.queue.push(downloadJob);
      } catch (error) {
        debug(`Failed to process download job: ${error}`);
      }
    });
  }

  async retryDownloadJob(
    readStream: Request,
    options: DownloadFileBase
  ): Promise<void> {
    const { path, start, end } = options;
    let fileHandle: FileHandle | undefined;
    const md5 = createHash("md5");
    let count = 0;
    try {
      fileHandle = await open(path, "r+");
      const writeStream = fileHandle.createWriteStream({ start });
      await pipeline(
        readStream,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            md5.update(chunk);
            count += chunk.length;
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
      if (count !== new Range(start, end).size()) {
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
        `Received invalid response from server: "etag" does not match MD5 checksum`
      );
    }
  }

  async finalizeDownloadJob(downloadJob: CompletedDownloadJob): Promise<void> {
    debug(`completed download job ${JSON.stringify(downloadJob)}`);
    await this.socket.emitWithAck("download:complete", downloadJob);
  }

  async runDownloadJob(
    downloadJob: DownloadJob
  ): Promise<CompletedDownloadJob> {
    const { url, name, start, end } = downloadJob;
    const path = join(name, downloadJob.path);

    // Create directory if it does not exist
    const { dir } = parse(path);
    await mkdir(dir, { recursive: true });

    // Create empty file if it does not exist
    let fileHandle = await open(path, "a");
    await fileHandle.close();

    const readStream: Request = client.stream.get(url, {
      retry: {
        limit: 100,
      },
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
          await this.retryDownloadJob(retryStream, {
            name,
            path,
            start,
            end,
          });
          await this.finalizeDownloadJob(downloadJob);
          resolve(downloadJob);
        } catch (error) {
          debug(error);
        }
      };
      fn(readStream);
    });
  }
}
