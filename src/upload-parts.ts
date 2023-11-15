import Debug from "debug";
import { stat } from "node:fs/promises";

import { delimiter } from "./config.js";
import { calculateChecksum } from "./fs.js";
import { FilePart, Job } from "./part.js";
import { Range } from "./range.js";

const debug = Debug("upload-client");

export interface UploadRequest extends FilePart {}
export interface UploadJob extends Job {}

export interface RangeOptions {
  minPartSize: number;
  maxPartCount: number;
}

export async function* generateUploadRequests(
  path: string,
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

    debug("generating checksum for %o", { path, size, range });
    const checksumMD5 = await calculateChecksum(path, "md5", range);
    debug("generated upload request %o", { path, size, range, checksumMD5 });

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
