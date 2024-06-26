import { Command, Option } from "commander";
import Debug from "debug";
import fastq, { queueAsPromised } from "fastq";
import Joi from "joi";
import { createHash } from "node:crypto";
import { FileHandle, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { join } from "path";

import { decode } from "@tsndr/cloudflare-worker-jwt";

import { Controller } from "../controller.js";
import { ChecksumJob, DownloadFile, DownloadJob } from "../download-schema.js";
import { getDataSource } from "../entity/data-source.js";
import { parseRange } from "../part.js";
import { _ClientSocket } from "../socket.js";
import { touch } from "../utils/fs.js";
import { client, requestOptions } from "../utils/http-client.js";
import { downloadPayloadSchema } from "../utils/payload.js";
import { Progress } from "../utils/progress.js";
import { Range } from "../utils/range.js";
import { signal } from "../utils/signal.js";
import { endpointSchema, makeClient } from "./socket-client.js";
import { WorkerPool } from "./worker.js";

import type { Request } from "got";
interface CompletedDownloadJob extends DownloadJob {
  size: number;
}

const debug = Debug("client");

export let downloadClient: DownloadClient | undefined;

export const makeDownloadClientCommand = () => {
  const command = new Command();
  command
    .name(`download-client`)
    .showHelpAfterError()
    .requiredOption("--endpoint <value>", "Where the server is located")
    .requiredOption("--token <value>", "Token to authenticate with the server")
    .option("--base-path <value>", "Upload paths relative to this directory")
    .option(
      "--num-threads <count>",
      "Number of concurrent upload threads",
      "20"
    )
    .addOption(
      new Option("--database-type <type>", "Which type of database to use")
        .choices(["sqlite", "postgres"])
        .default("sqlite")
    )
    .requiredOption(
      "--connection-string <path>",
      "Connection string to the database"
    )
    .action(async () => {
      debug("running with args %o", command.parent!.args);
      const options = command.opts();

      const endpoint = options["endpoint"];
      if (typeof endpoint !== "string") {
        throw new Error(`"endpoint" needs to be a string`);
      }
      Joi.assert(endpoint, endpointSchema);

      const token = options["token"];
      if (typeof token !== "string") {
        throw new Error(`"token" needs to be a string`);
      }
      const decoded = decode(token);
      if (typeof decoded !== "object" || decoded === null) {
        throw new Error(`"token" does not have a payload`);
      }
      Joi.attempt(decoded.payload, downloadPayloadSchema);

      const basePath: string | null = options["basePath"] || null;

      const numThreads = parseInt(options["numThreads"], 10);
      if (typeof numThreads !== "number") {
        throw new Error(`"numThreads" needs to be a number`);
      }

      const dataSource = await getDataSource(
        options["databaseType"],
        options["connectionString"]
      );
      const controller = new Controller(dataSource);
      downloadClient = new DownloadClient(
        endpoint,
        token,
        basePath,
        numThreads,
        controller
      );

      downloadClient.listen();
    });
  return command;
};

class DownloadClient {
  endpoint: string;
  token: string;

  socket: _ClientSocket;
  queue: queueAsPromised<DownloadJob, void>;
  progress: Progress = new Progress();

  basePath: string | null;

  downloads: Set<string> = new Set();
  checksumPaths: Set<string> = new Set();

  controller: Controller;

  workerPool: WorkerPool;

  constructor(
    endpoint: string,
    token: string,
    basePath: string | null,
    numThreads: number,
    controller: Controller
  ) {
    this.endpoint = endpoint;
    this.token = token;
    this.socket = makeClient(endpoint, token);
    this.basePath = basePath;
    this.queue = fastq.promise(this, this.runDownloadJob, numThreads);
    this.controller = controller;
    this.workerPool = new WorkerPool(numThreads);
  }

  terminate() {
    this.progress.terminate();
    this.socket.disconnect();
    this.queue.kill();
    this.workerPool.terminate();
  }

  listen() {
    this.socket.on("download:create", async (downloadJobs: DownloadJob[]) => {
      const promises: Promise<void>[] = [];
      for (const downloadJob of downloadJobs) {
        try {
          parseRange(downloadJob);

          const run = await this.controller.addFilePart(
            downloadJob.n,
            downloadJob
          );
          if (!run) {
            // debug(
            //   "not adding download job for %s in range %s because it already exists",
            //   downloadJob.path,
            //   downloadJob.range.toString()
            // );
            await this.socket.emitWithAck("download:complete", downloadJob);
            continue;
          }

          const key = `${downloadJob.path}:${downloadJob.range.toString()}`;
          if (this.downloads.has(key)) {
            continue;
          }
          this.downloads.add(key);

          this.progress.addPart(downloadJob);
          promises.push(this.queue.push(downloadJob));
        } catch (error) {
          debug("failed to process download job: %o", error);
        }
      }
      await Promise.all(promises);
    });
    this.socket.on("download:checksum", async (checksumJob: ChecksumJob) => {
      try {
        const { n, path, checksumSHA256 } = checksumJob;
        await this.controller.setChecksumSHA256(n, path, checksumSHA256);
        await this.verify(checksumJob);
      } catch (error) {
        debug("failed to process checksum job: %o", error);
      }
    });
    signal.finally(() => {
      this.terminate();
    });
  }

  makePath(job: DownloadFile): string {
    const paths = [job.n, job.path];
    if (this.basePath !== null) {
      paths.unshift(this.basePath);
    }
    const path = join(...paths);
    return path;
  }

  async retryDownloadJob(
    readStream: Request,
    downloadJob: DownloadJob
  ): Promise<CompletedDownloadJob> {
    const { progress } = this;
    const { start, end } = downloadJob.range;

    const path = this.makePath(downloadJob);
    await mkdir(dirname(path), { recursive: true });
    await touch(path);

    // debug("downloading %s to %s", downloadJob.url, path);

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

            progress.gauge.pulse();

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

  async verify(job: DownloadFile): Promise<void> {
    const file = await this.controller.getFile(job.n, job.path);

    if (file === null) {
      return;
    }
    if (!file.complete) {
      return;
    }
    if (file.checksumSHA256 === null) {
      return;
    }

    if (!file.verified) {
      const path = this.makePath(job);

      if (this.checksumPaths.has(path)) {
        // debug("already verifying checksum for %s", path);
        return;
      }
      this.checksumPaths.add(path);

      // debug("verifying checksum for %s", path);
      const checksumSHA256 = await this.workerPool.submitCalculateChecksum(
        path,
        "sha256"
      );
      if (checksumSHA256 === file.checksumSHA256) {
        debug("verified checksum for %s", path);
        await this.controller.setVerified(file.n, file.path);
      } else {
        throw new Error(
          `Invalid checksum for ${path}: ${checksumSHA256} != ${file.checksumSHA256}`
        );
      }
    }

    await this.socket.emitWithAck("download:verified", job);
  }
  async finalizeDownloadJob(downloadJob: CompletedDownloadJob): Promise<void> {
    this.progress.completePart(downloadJob);

    // debug(
    //   "completed partial download for %s in range %s",
    //   downloadJob.path,
    //   downloadJob.range.toString()
    // );

    await this.controller.completePart(downloadJob.n, downloadJob);
    const error = await this.socket.emitWithAck(
      "download:complete",
      downloadJob
    );
    if (error) {
      debug(
        "received error %o from server after sending complete event for %o",
        error,
        downloadJob
      );
    }
    await this.verify(downloadJob);
  }

  async runDownloadJob(downloadJob: DownloadJob): Promise<void> {
    return new Promise((resolve: (value: Promise<void>) => void) => {
      const download = async (retryStream: Request) => {
        retryStream.once(
          "retry",
          (retryCount: number, error, createRetryStream: () => Request) => {
            debug(
              "download job failed on attempt %d with error %o",
              retryCount,
              error.message
            );
            download(createRetryStream());
          }
        );
        try {
          await this.retryDownloadJob(retryStream, downloadJob);
          resolve(this.finalizeDownloadJob(downloadJob));
        } catch {
          // We do not care about this error, as `got` will retry the request
        }
      };

      const { url } = downloadJob;

      const options = { ...requestOptions };
      if (url.startsWith(this.endpoint)) {
        options.headers = {
          Authorization: this.token,
        };
      }

      let readStream: Request;
      try {
        readStream = client.stream.get(url, options);
      } catch (error) {
        debug(error);
        return;
      }

      download(readStream);
    });
  }
}
