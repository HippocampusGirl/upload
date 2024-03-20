import { GetObjectCommandInput } from "@aws-sdk/client-s3";

import { delimiter } from "./config.js";
import { nameSchema } from "./utils/payload.js";
import { Range } from "./utils/range.js";
import { prefix } from "./utils/storage.js";
import { validate } from "./utils/validate.js";

const getBucketNameFromURL = (url: string): string => {
  let { hostname } = new URL(url);
  // Get bucket name
  const bucket = hostname.split(".")[0];
  if (bucket === undefined || !bucket.startsWith(prefix)) {
    throw new Error(`Invalid bucket name: ${bucket}`);
  }
  return bucket;
};
const getPathnameFromURL = (url: string): string => {
  let { pathname } = new URL(url);
  if (pathname.startsWith(delimiter)) {
    pathname = pathname.slice(1);
  }
  return pathname;
};
const getNameFromBucket = (bucket: string): string => {
  if (!bucket.startsWith(prefix)) {
    throw new Error(`Invalid bucket name: ${bucket}`);
  }
  const name = bucket.slice(prefix.length);
  validate(nameSchema, name);
  return name;
};
export const getRangeFromPathname = (pathname: string): Range => {
  const tokens = pathname.split(delimiter);
  const suffix = tokens.pop();
  if (suffix === undefined) {
    throw new Error(`Invalid path: ${pathname}`);
  }
  let [start, end]: (number | undefined)[] = suffix
    .split("-")
    .map((n) => parseInt(n, 10));
  if (start === undefined || Number.isNaN(start) || start < 0) {
    throw new Error(`Invalid start: ${pathname}`);
  }
  if (end === undefined || Number.isNaN(end) || end < start || end < 0) {
    throw new Error(`Invalid end: ${pathname}`);
  }
  return new Range(start, end);
};
const getPathFromPathname = (pathname: string): string => {
  const tokens = pathname.split(delimiter);
  tokens.pop();
  return tokens.join(delimiter);
};
export const getPathFromURL = (url: string): string => {
  const pathname = getPathnameFromURL(url);
  return getPathFromPathname(pathname);
};
export const getInputFromURL = (url: string): GetObjectCommandInput => {
  const bucket = getBucketNameFromURL(url);
  return {
    Bucket: bucket,
    Key: getPathnameFromURL(url),
  };
};
