import { createHash } from "node:crypto";
import { FileHandle, open } from "node:fs/promises";
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
