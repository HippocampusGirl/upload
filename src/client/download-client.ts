import { decode } from "@tsndr/cloudflare-worker-jwt";
import { Command, Option } from "commander";
import Debug from "debug";
import Joi from "joi";
import { access, constants } from "node:fs/promises";
import { join } from "path";

import { IncomingHttpHeaders } from "node:http";
import { Controller } from "../controller.js";
import { ChecksumJob, DownloadFile, DownloadJob } from "../download-schema.js";
import { getDataSource } from "../entity/data-source.js";
import { File } from "../entity/file.js";
import { _ClientSocket } from "../socket.js";
import { CustomError } from "../utils/error.js";
import { downloadPayloadSchema } from "../utils/payload.js";
import { Progress } from "../utils/progress.js";
import { reduceRanges, size, toString } from "../utils/range.js";
import { signal } from "../utils/signal.js";
import { touch } from "./fs.js";
import { clientFactory, endpointSchema } from "./socket-client.js";
import { WorkerPool } from "./worker.js";

class DuplicateError extends CustomError {}

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
      "Number of concurrent download threads",
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
        options["connectionString"],
        options["debug"]
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

const isComplete = async (file: File): Promise<boolean> => {
  // debug("checking completion of file %o", file);
  if (file.size === null || file.checksumSHA256 === null) {
    // debug("file %o is not complete: size or checksum missing", file);
    return false;
  }
  const parts = await file.parts;
  if (parts.length === 0) {
    // debug("file %o is not complete: no parts", file);
    return false;
  }
  const [range] = reduceRanges(parts.filter(({ complete }) => complete));
  if (range === undefined) {
    // debug("file %o is not complete: no ranges", file);
    return false;
  }
  const { start } = range;
  const complete = start == 0 && size(range) == file.size;
  // debug("checked completion of file %o: %o", file, complete);
  return complete;
};

class DownloadClient {
  endpoint: string;
  token: string;

  socket: _ClientSocket;
  progress: Progress = new Progress();

  basePath: string | null;

  downloads: Set<string> = new Set();
  checksums: Set<string> = new Set();

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
    this.socket = clientFactory(endpoint, token);
    this.basePath = basePath;
    this.controller = controller;
    this.workerPool = new WorkerPool(numThreads);
  }

  terminate() {
    this.controller.queue.kill();
    this.progress.terminate();
    this.socket.disconnect();
    this.workerPool.terminate();
  }

  listen() {
    this.socket.on(
      "download:create",
      async (jobs: DownloadJob[], callback: (u: boolean) => void) => {
        const results = await Promise.allSettled(jobs.map(this.add, this));
        callback(true);

        const rejected = results.filter(
          ({ status }) => status === "rejected"
        ) as PromiseRejectedResult[];
        for (const { reason } of rejected) {
          if (reason instanceof DuplicateError) {
            continue;
          }
          debug("failed to process download job: %O", reason);
        }

        const fulfilled = results.filter(
          ({ status }) => status === "fulfilled"
        ) as PromiseFulfilledResult<DownloadJob>[];
        jobs = fulfilled.map(({ value }) => value);
        await Promise.allSettled(jobs.map(this.verify, this));

        const errors = await this.socket.emitWithAck("download:complete", jobs);
        for (const [i, error] of errors.entries()) {
          if (error === null) {
            continue;
          }
          const job = jobs[i];
          debug(
            "received error %o from server after sending complete event for %o",
            error,
            job
          );
        }
      }
    );
    this.socket.on("download:checksum", async (checksumJob: ChecksumJob) => {
      try {
        const { n, path, checksumSHA256 } = checksumJob;
        await this.controller.setChecksumSHA256(n, path, checksumSHA256);
        await this.verify(checksumJob);
      } catch (error) {
        debug("failed to process checksum job: %O", error);
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

  async verify(job: DownloadFile): Promise<void> {
    const file = await this.controller.getFileByPath(job.n, job.path);
    const path = this.makePath(job);

    if (file === null) {
      return;
    }
    const complete = await isComplete(file);
    if (!complete) {
      // debug("not running checksum because file is not complete: %s", path);
      return;
    }
    if (file.checksumSHA256 === null) {
      // debug(
      //   "not running checksum because target value is not available: %s",
      //   path
      // );
      return;
    }

    if (!file.verified) {
      try {
        await access(path, constants.R_OK);
      } catch (error) {
        // debug("not running checksum because file does not exist: %s", path);
        return;
      }

      if (this.checksums.has(file.checksumSHA256)) {
        // debug("already verifying checksum %s", file.checksumSHA256);
        return;
      }
      this.checksums.add(file.checksumSHA256);

      // debug("verifying checksum for %s", path);
      const checksumSHA256 = await this.workerPool.checksum({
        path,
        algorithm: "sha256",
      });
      this.checksums.delete(file.checksumSHA256);
      if (checksumSHA256 === file.checksumSHA256) {
        await this.controller.setVerified(file.n, file.path);
        debug("verified checksum for %s", path);
      } else {
        throw new Error(
          `Invalid checksum for ${path}: ${checksumSHA256} != ${file.checksumSHA256}`
        );
      }
    }

    await this.socket.emitWithAck("download:verified", job);
  }

  async add(job: DownloadJob): Promise<DownloadFile> {
    const { n, path, range, checksumMD5 } = job;
    const key = [n, path, toString(range), checksumMD5].join(":");
    if (this.downloads.has(key)) {
      throw new DuplicateError();
    }
    this.downloads.add(key);

    this.progress.add(job);
    const run = await this.controller.addPart(job.n, job);
    if (!run) {
      this.progress.complete(job);
      return job;
    }

    return await this.download(job);
  }
  async download(job: DownloadJob): Promise<DownloadFile> {
    const { url, range, checksumMD5 } = job;

    const path = this.makePath(job);
    await touch(path);

    const headers: IncomingHttpHeaders = {};
    if (url.startsWith(this.endpoint)) {
      headers["Authorization"] = this.token;
    }

    await this.workerPool.download({ url, checksumMD5, headers, range, path });

    this.progress.complete(job);
    await this.controller.setComplete(job.n, job);

    return job;
  }
}
