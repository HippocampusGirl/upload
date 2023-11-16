import Debug from "debug";

import {
  _Object,
  BucketLocationConstraint,
  CreateBucketCommand,
  CreateBucketCommandInput,
  HeadBucketCommand,
  ListBucketsCommand,
  ListObjectsCommand,
  ListObjectsCommandInput,
  S3Client
} from "@aws-sdk/client-s3";

import { getS3Config } from "./config.js";
import { CloudflareBucketLocationConstraint } from "./payload.js";

const debug = Debug("storage");

export const prefix = "upload-";

export const makeS3Client = (): S3Client => {
  const { endpoint, accessKeyId, secretAccessKey } = getS3Config();
  return new S3Client({
    region: "auto",
    endpoint: `https://${endpoint}`,
    credentials: { accessKeyId, secretAccessKey },
  });
};

export const getBucketName = (name: string): string => `${prefix}${name}`;
export const requireBucketName = async (
  s3: S3Client,
  name: string,
  loc: CloudflareBucketLocationConstraint | undefined
): Promise<string> => {
  const bucket = getBucketName(name);
  const bucketInput = { Bucket: bucket };

  try {
    await s3.send(new HeadBucketCommand(bucketInput));
  } catch (error) {
    try {
      const input: CreateBucketCommandInput = { ...bucketInput };
      if (loc !== undefined) {
        input.CreateBucketConfiguration = {
          LocationConstraint: loc as BucketLocationConstraint,
        };
      }
      await s3.send(new CreateBucketCommand(input));
    } catch (error) {
      debug(error);
      throw new Error("Failed to create bucket");
    }
  }

  return bucket;
};

export async function* listObjectsInBucket(
  s3: S3Client,
  bucket: string
): AsyncGenerator<_Object, void, undefined> {
  let isTruncated = false;
  const input: ListObjectsCommandInput = {
    Bucket: bucket,
  };
  do {
    const output = await s3.send(new ListObjectsCommand(input));
    isTruncated = output.IsTruncated ?? false;
    input.Marker = output.NextMarker;
    const objects = output.Contents;
    if (objects !== undefined) {
      yield* objects;
    }
  } while (isTruncated);
}

interface _BucketObject extends _Object {
  Bucket: string;
}

export async function* listObjects(
  s3: S3Client
): AsyncGenerator<_BucketObject, void, undefined> {
  const result = await s3.send(new ListBucketsCommand({}));
  const buckets = result.Buckets?.reduce((previousValue, bucket) => {
    if (bucket.Name?.startsWith(prefix)) {
      previousValue.push(bucket.Name);
    }
    return previousValue;
  }, new Array<string>());
  if (buckets === undefined) {
    return;
  }
  debug("listing %o buckets", buckets.length);
  for (const bucket of buckets) {
    for await (const object of listObjectsInBucket(s3, bucket)) {
      yield { ...object, Bucket: bucket };
    }
  }
}
