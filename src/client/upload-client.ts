import { parse } from "bytes";
import { Command, Option } from "commander";
import Debug from "debug";
import fastq, { queueAsPromised } from "fastq";
import { Request } from "got";
import Joi from "joi";
import { FileHandle, open } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { relative } from "node:path";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { inspect } from "node:util";

import { decode } from "@tsndr/cloudflare-worker-jwt";

import { UploadCreateError } from "../errors.js";
import { parseRange } from "../part.js";
import { _ClientSocket } from "../socket.js";
import { client, requestOptions } from "../utils/http-client.js";
import { uploadPayloadSchema } from "../utils/payload.js";
import { Progress } from "../utils/progress.js";
import { signal } from "../utils/signal.js";
import { endpointSchema, makeClient } from "./socket-client.js";
import { generateUploadRequests, RangeOptions, UploadJob, UploadRequest } from "./upload-parts.js";
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

      const socket = makeClient(endpoint, token);
      const client = new UploadClient(
        socket,
        basePath,
        numThreads,
        numUploadRequests
      );

      try {
        const uploadPromise = client.submitPaths(paths, {
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
    this.queue = fastq.promise(
      this,
      this.runUploadJob,
      Math.max(numThreads, 1)
    );
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
      });
      await pipeline(
        readStream,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            // debug("read chunk of %o of size %o", path, chunk.length);
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
    return new Promise(
      (resolve: (value: Promise<CompletedUploadJob>) => void) => {
        const upload = async (retryStream: Request) => {
          retryStream.once(
            "retry",
            (retryCount: number, error, createRetryStream: () => Request) => {
              debug(
                "upload job failed on attempt %d with error %o",
                retryCount,
                error.message
              );
              upload(createRetryStream());
            }
          );
          try {
            await this.retryUploadJob(retryStream, uploadJob);
            resolve(this.finalizeUploadJob(uploadJob));
          } catch {
            // We do not care about this error, as `got` will retry the request
          }
        };
        const { url, range } = uploadJob;
        const writeStream: Request = client.stream.put(url, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": `${range.size()}`,
          },
          ...requestOptions,
        });
        upload(writeStream);
      }
    );
  }

  async finalizeUploadJob(
    uploadJob: CompletedUploadJob
  ): Promise<CompletedUploadJob> {
    this.progress.completePart(uploadJob);

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

  async submitChecksum(path: string): Promise<void> {
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

  async createUploadJobs(
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
      this.progress.addPart(result);

      result.path = path;
      promises.push(this.queue.push(result));
    }

    return Promise.all(promises);
  }

  async submitPaths(paths: string[], options: RangeOptions): Promise<unknown> {
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
          promises.push(this.createUploadJobs(path, uploadRequests));
          uploadRequests = [];
        }
      }

      promises.push(this.createUploadJobs(path, uploadRequests));
      promises.push(this.submitChecksum(path));
      await Promise.all(promises);

      debug("completed upload for %o", path);
    });

    // debug("waiting for %d jobs", jobs.length);
    return Promise.all(jobs);
  }
}
