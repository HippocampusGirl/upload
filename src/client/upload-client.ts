import { parse } from "bytes";
import { Command, Option } from "commander";
import Debug from "debug";
import fastq, { queueAsPromised } from "fastq";
import Joi from "joi";
import { availableParallelism } from "node:os";
import { relative } from "node:path";
import { inspect } from "node:util";

import { decode } from "@tsndr/cloudflare-worker-jwt";

import retry from "async-retry";
import { createReadStream } from "node:fs";
import { IncomingHttpHeaders } from "node:http";
import { Transform, TransformCallback } from "node:stream";
import { Dispatcher, request } from "undici";
import { UploadCreateError } from "../errors.js";
import { parseRange } from "../part.js";
import { _ClientSocket } from "../socket.js";
import { InvalidResponseError, retryCodes } from "../utils/http-client.js";
import { uploadPayloadSchema } from "../utils/payload.js";
import { Progress } from "../utils/progress.js";
import { signal } from "../utils/signal.js";
import { clientFactory, endpointSchema } from "./socket-client.js";
import {
  generateUploadRequests,
  RangeOptions,
  UploadJob,
  UploadRequest,
} from "./upload-parts.js";
import { WorkerPool } from "./worker.js";

interface CompletedUploadJob extends UploadJob {}

const debug = Debug("client");

export const makeUploadClientCommand = () => {
  const command = new Command();
  command
    .name(`upload-client`)
    .showHelpAfterError()
    .requiredOption("--endpoint <value>", "Where the server is located")
    .requiredOption("--token <value>", "Token to authenticate with the server")
    .requiredOption("--path <value...>", "Path or paths to upload")
    .option("--base-path <value>", "Upload paths relative to this directory")
    .option(
      "--min-part-size <size>",
      "Minimum size of file parts for concurrent upload",
      "16MB"
    )
    .option("--max-part-count <size>", "Maximum number of file parts", "10000")
    .addOption(
      new Option(
        "--num-threads <number>",
        "Number of concurrent upload threads"
      ).default(availableParallelism())
    )
    .addOption(
      new Option(
        "--num-upload-requests <number>",
        "Number upload requests per path"
      ).default(10)
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
      Joi.attempt(decoded.payload, uploadPayloadSchema);

      const paths = options["path"];
      if (!Array.isArray(paths)) {
        throw new Error(`"paths" needs to be an array`);
      }
      const basePath: string | null = options["basePath"] || null;

      const minPartSize = parse(options["minPartSize"]);
      if (!Number.isInteger(minPartSize) || minPartSize === null) {
        throw new Error(`"minPartSize" is not an integer`);
      }
      const maxPartCount = Number(options["maxPartCount"]);
      if (!Number.isInteger(maxPartCount) || maxPartCount === null) {
        throw new Error(`"maxPartCount" is not an integer`);
      }

      const numThreads = parseInt(options["numThreads"], 10);
      if (typeof numThreads !== "number") {
        throw new Error(`"numThreads" needs to be a number`);
      }

      const numUploadRequests = parseInt(options["numUploadRequests"], 10);
      if (typeof numUploadRequests !== "number") {
        throw new Error(`"numUploadRequests" needs to be a number`);
      }

      const socket = clientFactory(endpoint, token);
      const client = new UploadClient(
        socket,
        basePath,
        numThreads,
        numUploadRequests
      );

      try {
        const uploadPromise = client.submit(paths, {
          minPartSize,
          maxPartCount,
        });
        await Promise.race([uploadPromise, signal]);
        if (inspect(uploadPromise).includes("pending")) {
          debug("upload not finished, caught signal");
        }
      } catch (error) {
        debug("error during upload %O", error);
      } finally {
        client.terminate();
      }
    });
  return command;
};

export class UploadClient {
  socket: _ClientSocket;
  queue: queueAsPromised<UploadJob, CompletedUploadJob>;
  workerPool: WorkerPool;
  numUploadRequests: number;

  progress: Progress = new Progress();

  basePath: string | null;

  constructor(
    socket: _ClientSocket,
    basePath: string | null,
    numThreads: number,
    numUploadRequests: number
  ) {
    this.socket = socket;
    this.queue = fastq.promise(this, this.upload, Math.max(numThreads, 1));
    this.numUploadRequests = numUploadRequests;
    this.workerPool = new WorkerPool(numThreads);
    this.basePath = basePath;
  }

  terminate() {
    this.progress.terminate();
    this.socket.disconnect();
    this.queue.kill();
    this.workerPool.terminate();
  }

  getRelativePath(path: string): string {
    if (this.basePath === null) {
      return path;
    }
    const relativePath = relative(this.basePath, path);
    if (relativePath.startsWith("..") || relativePath.startsWith("/")) {
      throw new Error(
        `Path ${path} is not in ${this.basePath}: ${relativePath}`
      );
    }
    return relativePath;
  }

  async create(
    path: string,
    uploadRequests: UploadRequest[]
  ): Promise<unknown> {
    if (uploadRequests.length === 0) {
      // Nothing to do
      return;
    }
    const results: (UploadJob | UploadCreateError)[] =
      await this.socket.emitWithAck("upload:create", uploadRequests);

    const promises: Promise<unknown>[] = [];
    for (const [index, result] of results.entries()) {
      if ("error" in result) {
        const { error } = result;
        const uploadRequest = uploadRequests[index];
        if (uploadRequest === undefined) {
          throw new Error(
            `Received invalid response from server: "uploadRequests[${index}]" is undefined`
          );
        }
        if (error == "upload-exists") {
          this.progress.addPart(uploadRequest);
          this.progress.setComplete(uploadRequest);
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
      this.progress.addPart(result);

      result.path = path;
      promises.push(this.queue.push(result));
    }

    return Promise.all(promises);
  }
  async submit(paths: string[], options: RangeOptions): Promise<unknown> {
    const jobs = paths.map(async (path): Promise<void> => {
      const relativePath = this.getRelativePath(path);

      const promises: Promise<unknown>[] = [];

      let uploadRequests: UploadRequest[] = [];
      for await (const uploadRequest of generateUploadRequests(
        path,
        this.workerPool,
        options
      )) {
        uploadRequest.path = relativePath;
        uploadRequests.push(uploadRequest);
        if (uploadRequests.length >= 10) {
          promises.push(this.create(path, uploadRequests));
          uploadRequests = [];
        }
      }

      promises.push(this.create(path, uploadRequests));
      promises.push(this.checksum(path));
      await Promise.all(promises);

      debug("completed upload for %o", path);
    });

    // debug("waiting for %d jobs", jobs.length);
    return Promise.all(jobs);
  }
  async upload(job: UploadJob): Promise<CompletedUploadJob> {
    const { progress } = this;

    const { url, path, range, checksumMD5 } = job;

    const headers: IncomingHttpHeaders = {
      "Content-Type": "application/octet-stream",
      "Content-Length": `${range.size()}`,
    };
    const body = createReadStream(path, {
      ...range,
    }).pipe(
      new Transform({
        transform(chunk: any, _, callback: TransformCallback) {
          progress.pulse();
          callback(null, chunk);
        },
      })
    );
    const data = await retry(
      async (
        bail: (e: Error) => void
      ): Promise<Dispatcher.ResponseData | void> => {
        try {
          return await request(url, { method: "PUT", headers, body });
        } catch (error: unknown) {
          if (error instanceof InvalidResponseError) {
            return bail(error);
          } else if (error instanceof Error) {
            throw error;
          } else {
            throw new Error(`Upload failed: ${error}`);
          }
        }
      }
    );
    if (data === undefined) {
      throw new Error("Upload failed");
    }

    const { statusCode } = data;

    if (statusCode !== 200) {
      const message = `Received status code ${statusCode} from server`;
      if (statusCode in retryCodes) {
        throw new Error(message);
      } else {
        throw new InvalidResponseError(message);
      }
    }

    return await this.finalize(job);
  }
  async finalize(uploadJob: CompletedUploadJob): Promise<CompletedUploadJob> {
    this.progress.setComplete(uploadJob);

    let error;
    try {
      uploadJob.path = this.getRelativePath(uploadJob.path);
      error = await this.socket.emitWithAck("upload:complete", uploadJob);
      if (error) {
        debug(
          "error occurred while finalizing upload job %o: %O",
          uploadJob,
          error
        );
      }
    } catch (error) {
      debug("error sending complete %o", error);
    }
    // debug(
    //   "completed partial upload for %s in range %s",
    //   uploadJob.path,
    //   uploadJob.range.toString()
    // );
    return uploadJob;
  }

  async checksum(path: string): Promise<void> {
    const checksumSHA256 = await this.workerPool.submitCalculateChecksum(
      path,
      "sha256"
    );
    const relativePath = this.getRelativePath(path);
    let error;
    try {
      error = await this.socket.emitWithAck(
        "upload:checksum",
        relativePath,
        checksumSHA256
      );
      if (error) {
        debug(
          "error submitting checksum job %o: %O",
          [path, checksumSHA256],
          error
        );
        // continue;
      }
    } catch (error) {
      debug("error sending checksum %o", error);
    }
  }
}
