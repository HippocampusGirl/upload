import Debug from "debug";
import { stat } from "node:fs/promises";

import { delimiter } from "../config.js";
import { FilePart, Job } from "../part.js";
import { Range } from "../utils/range.js";
import { WorkerPool } from "./worker.js";

const debug = Debug("upload-client");

export interface UploadRequest extends FilePart { }
export interface UploadJob extends Job { }

export interface RangeOptions {
  minPartSize: number;
  maxPartCount: number;
}

export async function* generateUploadRequests(
  path: string,
  workerPool: WorkerPool,
  { minPartSize, maxPartCount }: RangeOptions
): AsyncGenerator<UploadRequest, void, void> {
  const stats = await stat(path);
  const size = stats.size;

  const partCount = Math.min(
    maxPartCount,
    Math.floor(Number(size) / Number(minPartSize))
  );
  const partSize = Math.ceil(Number(size) / partCount);

  for (let i = 0; i < partCount; i++) {
    const start = i * partSize;
    let end = start + partSize;

    // Last part cannot go beyond the end of the file
    end = (end > size ? size : end) - 1;

    const range = new Range(start, end);
    const checksumMD5 = await workerPool.submitCalculateChecksum(
      path,
      "md5",
      range
    );

    // debug("generated upload requests %o of %o for %o", i + 1, partCount, path);
    yield { path, size, range, checksumMD5 };
  }
}

export const makeSuffix = (uploadRequest: UploadRequest): string => {
  const { size, range } = uploadRequest;
  const digits = size.toString(10).length;

  const [start, end] = [range.start, range.end].map((n) =>
    n.toString(10).padStart(digits, "0")
  );
  return `${delimiter}${start}-${end}`;
};
