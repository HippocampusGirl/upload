import { stat } from "node:fs/promises";

import { FilePart, Job } from "../part.js";
import { toSuffix } from "../utils/range.js";
import { WorkerPool } from "./worker.js";

export interface UploadRequest extends FilePart {}
export interface UploadJob extends Job {}

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

  let partCount = Math.floor(Number(size) / Number(minPartSize));
  if (partCount < 1) {
    partCount = 1;
  }
  if (partCount > maxPartCount) {
    partCount = maxPartCount;
  }
  const partSize = Math.ceil(Number(size) / partCount);

  // debug("will upload in %d chunks of size %d for %o", partCount, partSize, path);

  for (let i = 0; i < partCount; i++) {
    const start = i * partSize;
    let end = start + partSize;

    // Last part cannot go beyond the end of the file
    end = (end > size ? size : end) - 1;

    const range = { start, end };
    const checksumMD5 = await workerPool.checksum({
      path,
      algorithm: "md5",
      range,
    });

    yield { path, size, range, checksumMD5 };
  }
}

export const makeKey = (uploadRequest: UploadRequest): string => {
  const { range, size } = uploadRequest;
  const suffix = toSuffix(range, size);
  return `${uploadRequest.path}${suffix}`;
};
