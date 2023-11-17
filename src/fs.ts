import { createHash } from "node:crypto";
import {
  CreateReadStreamOptions,
  FileHandle,
  mkdir,
  open
} from "node:fs/promises";
import { parse } from "node:path";
import { pipeline } from "node:stream/promises";

import { Range } from "./range.ts";

export interface ChecksumTask {
  path: string;
  range?: Range;
  algorithm: string;
}
export const calculateChecksum = async (
  path: string,
  algorithm: string,
  range?: Range
): Promise<string> => {
  const options: CreateReadStreamOptions = {};
  if (range) {
    options.start = range.start;
    options.end = range.end;
  }

  const sha256 = createHash(algorithm);

  let fileHandle: FileHandle | undefined;
  try {
    fileHandle = await open(path);
    const readStream = fileHandle.createReadStream(options);
    await pipeline(readStream, sha256);
  } finally {
    await fileHandle?.close();
  }

  return sha256.digest("hex");
};

export const touch = async (path: string): Promise<void> => {
  // Create directory if it does not exist
  const { dir } = parse(path);
  await mkdir(dir, { recursive: true });

  // Create empty file if it does not exist
  let fileHandle;
  try {
    fileHandle = await open(path, "a");
  } finally {
    await fileHandle?.close();
  }
};
