import { GetObjectCommandInput } from "@aws-sdk/client-s3";

import { delimiter } from "./config.js";
import { nameSchema, validate } from "./schema.js";
import { prefix } from "./storage.js";

export interface DownloadFileBase {
  name: string;
  path: string;
  start: number;
  end?: number;
}

export interface DownloadFileOptions extends DownloadFileBase {
  type: "file";
  input: GetObjectCommandInput;
}
export interface DownloadChecksumOptions {
  type: "checksum";
  name: string;
  path: string;
}
export type DownloadOptions = DownloadFileOptions | DownloadChecksumOptions;

export interface DownloadJob extends DownloadFileBase {
  url: string;
}

export const makeDownloadOptions = (url: string): DownloadOptions => {
  let { hostname, pathname } = new URL(url);
  if (pathname.startsWith(delimiter)) {
    pathname = pathname.slice(1);
  }

  const bucket = hostname.split(".")[0];
  if (!bucket.startsWith(prefix)) {
    throw new Error(`Invalid bucket name: ${bucket}`);
  }
  const name = bucket.slice(prefix.length);
  validate(nameSchema, name);

  const tokens = pathname.split(delimiter);
  const suffix = tokens.pop();
  let path = tokens.join(delimiter);

  if (suffix === undefined) {
    throw new Error(`Invalid path: ${pathname}`);
  }
  if (suffix === "sha256") {
    return { type: "checksum", name, path };
  }
  let [start, end]: (number | undefined)[] = suffix
    .split("-")
    .map((n) => parseInt(n, 10));
  if (Number.isNaN(start) || start < 0) {
    throw new Error(`Invalid start: ${pathname}`);
  }
  if (Number.isNaN(end)) {
    end = undefined;
  } else {
    if (end < start || end < 0) {
      throw new Error(`Invalid end: ${pathname}`);
    }
  }
  const input: GetObjectCommandInput = {
    Bucket: bucket,
    Key: pathname,
  };
  return { type: "file", input, name, path, start, end };
};
