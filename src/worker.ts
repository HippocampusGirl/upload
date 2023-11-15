import Debug from "debug";
import fastq, { queueAsPromised } from "fastq";
import { execFileSync } from "node:child_process";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData
} from "node:worker_threads";

import { calculateChecksum } from "./fs.js";
import { parseRange } from "./part.js";
import { Range } from "./range.js";

const debug = Debug("upload-client");

interface ChecksumTask {
  path: string;
  range?: Range;
  algorithm: string;
}

const runCalculateChecksum = async (
  checksumTask: ChecksumTask
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: checksumTask,
    });
    worker.on("message", (message) => {
      if (typeof message !== "string") {
        reject(new Error("Invalid message"));
      }
      resolve(message);
    });
    worker.on("error", (error) => {
      reject(error);
    });
  });
};

// const stdout = execFileSync("nproc", { encoding: "utf-8" });
// const numThreads = parseInt(stdout, 10);
// if (Number.isNaN(numThreads)) {
//   throw new Error(`Invalid number of threads: ${stdout}`);
// }
const numThreads = 32;
if (isMainThread) {
  debug(`Will use ${numThreads} threads for checksum calculation`);
}

let checksumQueue: queueAsPromised<ChecksumTask, string> = fastq.promise(
  runCalculateChecksum,
  numThreads
);

export const submitCalculateChecksum = async (
  path: string,
  algorithm: string,
  range?: Range
): Promise<string> => {
  return checksumQueue.push({ path, algorithm, range });
};

export const worker = async (): Promise<void> => {
  if (parentPort === null) {
    throw new Error("Invalid parentPort");
  }
  if (workerData.range !== undefined) {
    parseRange(workerData);
  }
  const { path, algorithm, range } = workerData;
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
};

// type Task = ChecksumTask;

// interface Deferred {
//   task: Task;
//   resolve: (value: string) => void;
//   reject: (reason: string) => void;
// }

// interface ChecksumResult {
//   type: "checksum";
//   checksum: string;
// }
// interface ErrorResult {
//   type: "error";
//   error: string;
// }
// type Result = ChecksumResult | ErrorResult;

// declare module "node:worker_threads" {
//   interface Worker extends ExtendedWorker {}
// }
// interface ExtendedWorker {
//   taskInfo: TaskInfo | null;
// }

// // Adapted from https://nodejs.org/api/async_context.html#using-asyncresource-for-a-worker-thread-pool
// const kTaskInfo = Symbol("kTaskInfo");
// const kWorkerFreedEvent = Symbol("worker-freed");

// class TaskInfo extends AsyncResource {
//   constructor(callback) {
//     super("task-info");
//     this.callback = callback;
//   }

//   done(err, result) {
//     this.runInAsyncScope(this.callback, null, err, result);
//     this.emitDestroy(); // `TaskInfo`s are used only once.
//   }
// }

// export default class WorkerPool extends EventEmitter {
//   constructor(numThreads) {
//     super();
//     this.numThreads = numThreads;
//     this.workers = [];
//     this.freeWorkers = [];
//     this.tasks = [];

//     for (let i = 0; i < numThreads; i++) this.addNewWorker();

//     // Any time the kWorkerFreedEvent is emitted, dispatch
//     // the next task pending in the queue, if any.
//     this.on(kWorkerFreedEvent, () => {
//       if (this.tasks.length > 0) {
//         const { task, callback } = this.tasks.shift();
//         this.runTask(task, callback);
//       }
//     });
//   }

//   addNewWorker() {
//     const worker = new Worker(new URL("task_processor.js", import.meta.url));
//     worker.on("message", (result) => {
//       // In case of success: Call the callback that was passed to `runTask`,
//       // remove the `TaskInfo` associated with the Worker, and mark it as free
//       // again.
//       worker[kTaskInfo].done(null, result);
//       worker[kTaskInfo] = null;
//       this.freeWorkers.push(worker);
//       this.emit(kWorkerFreedEvent);
//     });
//     worker.on("error", (err) => {
//       // In case of an uncaught exception: Call the callback that was passed to
//       // `runTask` with the error.
//       if (worker[kTaskInfo]) worker[kTaskInfo].done(err, null);
//       else this.emit("error", err);
//       // Remove the worker from the list and start a new Worker to replace the
//       // current one.
//       this.workers.splice(this.workers.indexOf(worker), 1);
//       this.addNewWorker();
//     });
//     this.workers.push(worker);
//     this.freeWorkers.push(worker);
//     this.emit(kWorkerFreedEvent);
//   }

//   runTask(task, callback) {
//     if (this.freeWorkers.length === 0) {
//       // No free threads, wait until a worker thread becomes free.
//       this.tasks.push({ task, callback });
//       return;
//     }

//     const worker = this.freeWorkers.pop();
//     worker[kTaskInfo] = new WorkerPoolTaskInfo(callback);
//     worker.postMessage(task);
//   }

//   close() {
//     for (const worker of this.workers) worker.terminate();
//   }
// }
