import retry from "async-retry";
import Debug from "debug";
import { AsyncResource } from "node:async_hooks";
import EventEmitter from "node:events";
import { availableParallelism } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parentPort, Worker } from "node:worker_threads";

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { IncomingHttpHeaders } from "node:http";
import { Transform, TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { Dispatcher, request } from "undici";
import { parseRange } from "../part.js";
import { InvalidResponseError, retryCodes } from "../utils/http-client.js";
import { tsNodeArgv } from "../utils/loader.js";
import { Range } from "../utils/range.js";
import { calculateChecksum } from "./fs.js";

const debug = Debug("worker");

interface ChecksumInput {
  type: "checksum";
  path: string;
  algorithm: string;
  range?: Range;
}
interface DownloadInput {
  type: "download";
  url: string;
  checksumMD5: string;
  path: string;
  range: Range;
  headers: IncomingHttpHeaders;
}
type Input = ChecksumInput | DownloadInput;

type Callback = (error: Error | null, value: string | undefined) => void;
interface Task<T> {
  input: T;
  callback: Callback;
}

class TaskInfo<S> extends AsyncResource {
  private callback: Callback;

  constructor(callback: Callback) {
    super("task-info");
    this.callback = callback;
  }

  done(error: Error | null, value: S): void {
    this.runInAsyncScope(this.callback, null, error, value);
    this.emitDestroy(); // `TaskInfo`s are used only once.
  }
}

const kTaskInfo = Symbol("kTaskInfo");
const kWorkerFreedEvent = Symbol("kWorkerFreedEvent");
const kErrorEvent = Symbol("kErrorEvent");

declare module "node:worker_threads" {
  interface Worker extends ExtendedWorker {}
}
interface ExtendedWorker {
  [kTaskInfo]?: TaskInfo<any>;
}
export class WorkerPool extends EventEmitter {
  private workers: Worker[] = [];
  private freeWorkers: Worker[] = [];
  private tasks: Task<any>[] = [];

  constructor(numThreads: number = 4 * availableParallelism()) {
    super();

    debug(`will use ${numThreads} worker threads`);
    for (let i = 0; i < numThreads; i++) {
      this.addNewWorker();
    }

    this.on(kWorkerFreedEvent, () => {
      if (this.tasks.length > 0) {
        const task = this.tasks.shift();
        if (task === undefined) {
          throw new Error("Invalid task");
        }
        this.runTask(task);
      }
    });
    this.on(kErrorEvent, (error: Error) => {
      throw error;
    });
  }

  private addNewWorker(): void {
    const workerPath = fileURLToPath(import.meta.url);
    const extension = extname(workerPath);
    const indexPath = join(dirname(workerPath), `../index${extension}`);

    const execArgv: string[] = [];
    if (extension === ".ts") {
      execArgv.unshift(...tsNodeArgv);
    }

    const worker = new Worker(indexPath, { execArgv });
    worker.on("message", (value: unknown) => {
      const taskInfo = worker[kTaskInfo];
      if (taskInfo === undefined) {
        throw new Error("Invalid taskInfo");
      }
      taskInfo.done(null, value);

      this.freeWorkers.push(worker);
      this.emit(kWorkerFreedEvent);
    });
    worker.on("error", (error: Error) => {
      const taskInfo = worker[kTaskInfo];
      if (taskInfo !== undefined) {
        taskInfo.done(error, null);
      } else this.emit(kErrorEvent, error);
      // Remove the worker from the list and start a new Worker to replace the
      // current one.
      this.workers.splice(this.workers.indexOf(worker), 1);
      this.addNewWorker();
    });
    this.workers.push(worker);
    this.freeWorkers.push(worker);
    this.emit(kWorkerFreedEvent);
  }

  private async run<T>(input: T): Promise<string> {
    const value = await promisify(this.runCallback).bind(this)(input);
    if (typeof value !== "string") {
      throw new Error("Invalid value");
    }
    return value;
  }
  private runCallback<T>(input: T, callback: Callback): void {
    const task = { input, callback };
    this.runTask(task);
  }
  private runTask<T>(task: Task<T>) {
    if (this.freeWorkers.length === 0) {
      debug("no free workers, waiting for a worker to become free");
      this.tasks.push(task);
      return;
    }

    const { input, callback } = task;
    const worker = this.freeWorkers.pop();
    if (worker === undefined) {
      throw new Error("Invalid worker");
    }

    worker[kTaskInfo] = new TaskInfo(callback);
    worker.postMessage(input);
  }

  public download(o: Omit<DownloadInput, "type">): Promise<string> {
    const input: DownloadInput = { type: "download", ...o };
    return this.run(input);
  }
  public checksum(o: Omit<ChecksumInput, "type">): Promise<string> {
    const input: ChecksumInput = { type: "checksum", ...o };
    return this.run(input);
  }

  public async terminate(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.terminate()));
  }
}

export const worker = (): void => {
  if (parentPort === null) {
    throw new Error("Invalid parentPort");
  }

  const download = async (input: DownloadInput): Promise<string> => {
    const { url, checksumMD5, path, range, headers } = input;
    const opaque: Opaque = { path, range, checksumMD5 };

    await retry(async (bail: (e: Error) => void) => {
      try {
        const data = await request(url, {
          method: "GET",
          headers,
          opaque,
          idempotent: true,
        });
        await factory(data);
      } catch (error: unknown) {
        debug("retrying download because of error: %O", error);
        if (error instanceof InvalidResponseError) {
          bail(error);
        } else if (error instanceof Error) {
          throw error;
        } else {
          throw new Error(`Download failed: ${error}`);
        }
      }
    });

    return checksumMD5;
  };
  const checksum = async (input: ChecksumInput): Promise<string> => {
    if (input.range !== undefined) {
      parseRange(input);
    }
    const { path, algorithm, range } = input;
    if (typeof path !== "string") {
      throw new Error("Invalid path");
    }
    if (typeof algorithm !== "string") {
      throw new Error("Invalid algorithm");
    }
    if (!(range === undefined || range instanceof Range)) {
      throw new Error(`Invalid range ${range}`);
    }
    const checksum = await calculateChecksum(path, algorithm, range);
    return checksum;
  };

  parentPort.on("message", async (input: Input): Promise<void> => {
    if (parentPort === null) {
      throw new Error("Invalid parentPort");
    }

    debug("running %s task: %O", input.type, input);

    switch (input.type) {
      case "checksum":
        parentPort.postMessage(await checksum(input));
        break;
      case "download":
        parentPort.postMessage(await download(input));
        break;
      default:
        throw new Error(`Invalid input type ${input}`);
    }
  });
};

interface Opaque {
  path: string;
  range: Range;
  checksumMD5: string;
}

const factory = async (data: Dispatcher.ResponseData): Promise<void> => {
  const { statusCode } = data;

  const message = `received status code ${statusCode} from server`;
  if (statusCode !== 200) {
    if (statusCode in retryCodes) {
      throw new Error(message);
    } else {
      throw new InvalidResponseError(message);
    }
  }

  const {
    path,
    range: { start, end },
    checksumMD5,
  } = data.opaque as Opaque;

  const md5 = createHash("md5");
  let size = 0;
  const transform = new Transform({
    transform(chunk: any, _, callback: TransformCallback) {
      md5.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });

  const write = createWriteStream(path, { flags: "r+", start });
  await pipeline(data.body, transform, write);

  // debug('finished writing "%s"', path);
  if (end !== undefined) {
    const expected = new Range(start, end).size();
    if (size !== expected) {
      throw new InvalidResponseError(
        `Content length does not match suffix: ${size} != ${expected}`
      );
    }
  }
  const etagHeader = data.headers["etag"];
  if (etagHeader === undefined) {
    throw new InvalidResponseError('Missing "etag" header');
  } else if (typeof etagHeader !== "string") {
    throw new InvalidResponseError('"etag" header needs to be a string');
  }
  const etag = JSON.parse(etagHeader); // remove quotes
  if (typeof etag !== "string") {
    throw new InvalidResponseError('"etag" needs to be a string');
  }
  if (etag !== md5.digest("hex")) {
    throw new InvalidResponseError(
      '"etag" does not match MD5 checksum calculated from response body'
    );
  }
  if (checksumMD5 !== etag) {
    throw new InvalidResponseError(
      '"etag" does not match MD5 checksum received from server'
    );
  }
};
