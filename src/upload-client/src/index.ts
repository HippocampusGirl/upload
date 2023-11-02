import { CompletedPart } from "@aws-sdk/client-s3";
import { client } from "./client.js";
import fastq, { queueAsPromised } from "fastq";
import { Request } from "got";
import { createHash } from "node:crypto";
import { FileHandle, open } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { endpoint, numThreads, paths, token } from "./options.js";
import { UploadPart, createUploadParts } from "./parts.js";
import { initializeProgress, updateProgress } from "./progress.js";

async function uploadData(
  writeStream: Request,
  part: UploadPart
): Promise<CompletedPart> {
  let fileHandle: FileHandle | undefined;
  const partHash = createHash("sha256");
  try {
    fileHandle = await open(part.path);
    const readStream = fileHandle.createReadStream({
      start: part.start,
      end: part.end,
      highWaterMark: 512 * 1024, // 512KB
    });
    await pipeline(
      readStream,
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          partHash.update(chunk);
          updateProgress();
          yield chunk;
        }
      },
      writeStream,
      new PassThrough()
    );
  } finally {
    await fileHandle?.close();
  }
  const ETag = writeStream.response?.headers.etag;
  if (typeof ETag !== "string") {
    throw new Error(
      `Received invalid response from server: "etag" needs to be a string`
    );
  }
  const PartNumber = parseInt(
    writeStream.requestUrl?.searchParams.get("partNumber") ?? "",
    10
  );
  if (isNaN(PartNumber)) {
    throw new Error(
      `Received invalid "url" from server: "partNumber" needs to be a number`
    );
  }
  return {
    PartNumber,
    ETag,
    ChecksumSHA256: partHash.digest("base64"),
  };
}

async function uploadPart(part: UploadPart): Promise<CompletedPart> {
  let writeStream: Request = client.stream.put(part.url, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": `${part.size()}`,
    },
    retry: {
      limit: 100,
    },
  });
  return new Promise((resolve, reject) => {
    const fn = async (retryStream: Request) => {
      try {
        retryStream.once(
          "retry",
          (retryCount: number, error, createRetryStream: () => Request) => {
            fn(createRetryStream());
          }
        );
        const completedPart = await uploadData(retryStream, part);
        updateProgress(part);
        resolve(completedPart);
      } catch (error) {}
    };
    fn(writeStream);
  });
}

const queue: queueAsPromised<UploadPart, CompletedPart> = fastq.promise(
  uploadPart,
  numThreads
);

async function main() {
  const uploadParts = await createUploadParts(paths);
  initializeProgress(uploadParts);
  await Promise.all(
    uploadParts.map(async (parts, i: number) => {
      const path = paths[i];
      const completedParts = await Promise.all(parts.map(queue.push));
      await client
        .post(`${endpoint}/file/complete`, {
          json: {
            Token: token,
            Key: path,
            Parts: completedParts,
          },
        })
        .json();
    })
  );
}
main();
