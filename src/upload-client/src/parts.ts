import { client } from "./client.js";
import { stat } from "node:fs/promises";
import { endpoint, minPartSize, token } from "./options.js";

export class UploadPart {
  path: string;
  start: number; // inclusive
  end: number; // inclusive
  url: string;

  constructor(path: string, start: number, end: number, url: string) {
    this.path = path;
    this.start = start;
    this.end = end;
    this.url = url;
  }

  size(): number {
    return this.end - this.start + 1;
  }
}

export async function createUploadParts(
  paths: string[]
): Promise<UploadPart[][]> {
  return Promise.all(
    paths.map(async (path: string) => {
      const stats = await stat(path);
      const size = stats.size;
      const partCount = Math.min(
        10000,
        Math.floor(Number(size) / Number(minPartSize))
      );
      let urls = await client
        .post(`${endpoint}/file/create`, {
          json: { Token: token, PartCount: partCount, Key: path },
        })
        .json();
      if (!Array.isArray(urls)) {
        throw new Error(
          `Received invalid response from server: "urls" needs to be an array`
        );
      }
      const partSize = Math.ceil(Number(size) / partCount);
      const parts: UploadPart[] = new Array();
      for (let i = 0; i < partCount; i++) {
        const start = i * partSize;
        let end = start + partSize;
        end = (end > size ? size : end) - 1;
        const part = new UploadPart(path, start, end, urls[i]);
        if (part.size() < minPartSize) {
          parts[parts.length - 1].end = end;
          continue;
        }
        parts.push(part);
      }
      return parts;
    })
  );
}
