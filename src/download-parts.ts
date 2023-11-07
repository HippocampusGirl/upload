import Debug from "debug";

import { GetObjectCommandInput } from "@aws-sdk/client-s3";

import { checksumSuffix, delimiter } from "./config.js";
import { nameSchema, validate } from "./schema.js";
import { prefix } from "./storage.js";

interface Base {
  name: string;
  path: string;
}
export interface DownloadFileBase extends Base {
  start: number;
  end?: number;
}

export interface DownloadFileOptions extends DownloadFileBase {
  type: "file";
  input: GetObjectCommandInput;
}
export interface DownloadChecksumOptions extends Base {
  type: "checksum";
  input: GetObjectCommandInput;
}
export type DownloadOptions = DownloadFileOptions | DownloadChecksumOptions;

export interface DownloadJob extends DownloadFileBase {
  url: string;
}

export interface ChecksumJob extends Base {
  checksumSha256: string;
}

const debug = Debug("serve");

export const makeDownloadOptions = (url: string): DownloadOptions => {
  let { hostname, pathname } = new URL(url);
  if (pathname.startsWith(delimiter)) {
    pathname = pathname.slice(1);
  }

  // Get bucket name
  const bucket = hostname.split(".")[0];
  if (!bucket.startsWith(prefix)) {
    throw new Error(`Invalid bucket name: ${bucket}`);
  }
  const input: GetObjectCommandInput = {
    Bucket: bucket,
    Key: pathname,
  };

  // Get token name
  const name = bucket.slice(prefix.length);
  validate(nameSchema, name);

  // Get file path
  const tokens = pathname.split(delimiter);
  const suffix = tokens.pop();
  let path = tokens.join(delimiter);

  if (suffix === undefined) {
    throw new Error(`Invalid path: ${pathname}`);
  }
  if (suffix === "sha256") {
    return { type: "checksum", input, name, path };
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
  return { type: "file", input, name, path, start, end };
};

export const makeChecksumJob = (url: string): DownloadChecksumOptions => {
  const downloadOptions = makeDownloadOptions(url);
  if (downloadOptions.type === "checksum") {
    return downloadOptions;
  }
  const { name, path } = downloadOptions;
  let { input } = downloadOptions;
  input.Key = `${path}${delimiter}${checksumSuffix}`;
  return { type: "checksum", input, name, path };
};
