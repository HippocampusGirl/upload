import Debug from "debug";
import { AsyncResource } from "node:async_hooks";
import EventEmitter from "node:events";
import { availableParallelism } from "node:os";
import { parentPort, Worker } from "node:worker_threads";

import { parseRange } from "../part.js";
import { calculateChecksum } from "../utils/fs.js";
import { Range } from "../utils/range.js";

const debug = Debug("upload-client");

interface Input {
  path: string;
  algorithm: string;
  range: Range | undefined;
}

type Callback = (error: Error | null, checksum: string | null) => void;
interface Task {
  input: Input;
  callback: Callback;
}

class TaskInfo extends AsyncResource {
  private callback: Callback;

  constructor(callback: Callback) {
    super("task-info");
    this.callback = callback;
  }

  done(error: Error | null, checksum: string | null): void {
    this.runInAsyncScope(this.callback, null, error, checksum);
    this.emitDestroy(); // `TaskInfo`s are used only once.
  }
}

const kTaskInfo = Symbol("kTaskInfo");
const kWorkerFreedEvent = Symbol("kWorkerFreedEvent");
const kErrorEvent = Symbol("kErrorEvent");

declare module "node:worker_threads" {
  interface Worker extends ExtendedWorker { }
}
interface ExtendedWorker {
  [kTaskInfo]?: TaskInfo;
}
export class WorkerPool extends EventEmitter {
  private workers: Worker[] = new Array();
  private freeWorkers: Worker[] = new Array();
  private tasks: Task[] = new Array();

  constructor() {
    super();

    const numThreads = 4 * availableParallelism();
    debug(`will use ${numThreads} threads for checksum calculation`);
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
    const worker = new Worker(new URL(import.meta.resolve("../index.js")));
    worker.on("message", (checksum: any) => {
      if (typeof checksum !== "string") {
        throw new Error("Invalid checksum");
      }

      const taskInfo = worker[kTaskInfo];
      if (taskInfo === undefined) {
        throw new Error("Invalid taskInfo");
      }
      taskInfo.done(null, checksum);

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

  private runTask(task: Task) {
    if (this.freeWorkers.length === 0) {
      // No free threads, wait until a worker thread becomes free.
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

  public submitCalculateChecksum(
    path: string,
    algorithm: string,
    range?: Range
  ): Promise<string> {
    const input: Input = { path, range, algorithm };
    return new Promise((resolve, reject) => {
      const callback = (error: Error | null, checksum: string | null) => {
        if (checksum !== null) {
          resolve(checksum);
        } else {
          reject(error);
        }
      };
      const task = { input, callback };
      this.runTask(task);
    });
  }
}

export const worker = (): void => {
  if (parentPort === null) {
    throw new Error("Invalid parentPort");
  }
  parentPort.on("message", async (input: Input): Promise<void> => {
    if (parentPort === null) {
      throw new Error("Invalid parentPort");
    }
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
    parentPort.postMessage(checksum);
  });
};
