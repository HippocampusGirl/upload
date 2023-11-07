import { createHash } from "node:crypto";
import { FileHandle, mkdir, open } from "node:fs/promises";
import { parse } from "node:path";
import { pipeline } from "node:stream/promises";

export const calculateChecksum = async (path: string): Promise<string> => {
  let fileHandle: FileHandle | undefined;
  const sha256 = createHash("sha256");
  try {
    fileHandle = await open(path);
    const readStream = fileHandle.createReadStream();
    await pipeline(readStream, sha256);
  } finally {
    await fileHandle?.close();
  }
  return sha256.digest("base64");
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
