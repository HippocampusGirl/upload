import Debug from "debug";
import { createHash } from "node:crypto";

import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

import { createB2Bucket } from "./b2.js";
import { prefix } from "./prefix.js";
import { createS3Bucket } from "./s3.js";

const debug = Debug("storage");
export const createBucket = async (
  s3: S3Client,
  bucket: string
): Promise<void> => {
  const endpointProvider = s3.config.endpoint;
  if (!endpointProvider) {
    throw new Error("S3Client endpoint is not defined");
  }
  const { hostname } = await endpointProvider();
  if (hostname.endsWith("backblazeb2.com")) {
    debug("creating bucket %o via backblaze api at %o", bucket, hostname);
    return createB2Bucket(s3, bucket);
  } else {
    debug("creating bucket %o via s3 api at %o", bucket, hostname);
    return createS3Bucket(s3, bucket);
  }
};
export const makeBucketName = (name: string, accessKeyId: string): string => {
  const suffix = createHash("sha256")
    .update(accessKeyId, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `${prefix}-${name}-${suffix}`;
};
/**
 * Checks if a bucket with the specified name exists in storage.
 * If the bucket does not exist, it creates a new bucket with the given name.
 * Returns the name of the bucket.
 *
 * @param s3 - The S3 client object.
 * @param name - The name of the bucket.
 * @returns A Promise that resolves to the name of the bucket.
 */
export const requireBucketName = async (
  s3: S3Client,
  name: string
): Promise<string> => {
  const { accessKeyId } = await s3.config.credentials();
  const bucket = makeBucketName(name, accessKeyId);
  const input = { Bucket: bucket };

  try {
    await s3.send(new HeadBucketCommand(input));
  } catch (error) {
    await createBucket(s3, bucket);
  }

  return bucket;
};
