import Debug from "debug";

import {
    _Object, BucketLocationConstraint, CreateBucketCommand, CreateBucketCommandInput,
    ListBucketsCommand, ListObjectsCommand, ListObjectsCommandInput, S3Client
} from "@aws-sdk/client-s3";

import { prefix } from "./prefix.js";

// Allow socket to store payload
declare module "@aws-sdk/client-s3" {
  interface S3Client extends ExtendedS3Client {}
}
interface ExtendedS3Client {
  bucketLocationConstraint: string | null;
}

const debug = Debug("storage");

export const createS3Bucket = async (
  s3: S3Client,
  bucket: string
): Promise<void> => {
  const input: CreateBucketCommandInput = { Bucket: bucket };
  if (s3.bucketLocationConstraint) {
    input.CreateBucketConfiguration = {
      LocationConstraint:
        s3.bucketLocationConstraint as BucketLocationConstraint,
    };
  }
  try {
    await s3.send(new CreateBucketCommand(input));
  } catch (error) {
    debug("failed to create bucket with input %o: %O", input, error);
    throw new Error("Failed to create bucket");
  }
};
async function* listObjectsInBucket(
  s3: S3Client,
  bucket: string
): AsyncGenerator<_Object, void, undefined> {
  let isTruncated = false;
  const input: ListObjectsCommandInput = {
    Bucket: bucket,
  };
  do {
    const output = await s3.send(new ListObjectsCommand(input));
    const objects: _Object[] = output.Contents ?? [];
    const lastObject: _Object | undefined = objects[objects.length - 1];
    isTruncated = output.IsTruncated ?? false;
    if (isTruncated) {
      // As per https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjects.html#API_ListObjects_ResponseSyntax
      if (output.NextMarker !== undefined) {
        input.Marker = output.NextMarker;
      } else if (lastObject !== undefined && lastObject.Key !== undefined) {
        input.Marker = lastObject.Key;
      } else {
        throw new Error(
          "ListObjectsCommand did not return a marker even though IsTruncated is true"
        );
      }
    }
    if (objects !== undefined) {
      yield* objects;
    }
  } while (isTruncated);
}

export interface _BucketObject extends _Object {
  Bucket: string;
}

export async function* listObjects(
  s3: S3Client
): AsyncGenerator<_BucketObject, void, undefined> {
  const result = await s3.send(new ListBucketsCommand({}));
  const buckets: string[] = [];
  for (const bucket of result.Buckets ?? []) {
    if (bucket.Name?.startsWith(prefix)) {
      buckets.push(bucket.Name);
    }
  }
  if (!buckets) {
    return;
  }
  debug("listing %o buckets", buckets.length);
  for (const bucket of buckets) {
    try {
      for await (const object of listObjectsInBucket(s3, bucket)) {
        yield { ...object, Bucket: bucket };
      }
    } catch (error) {
      debug("failed to list objects in bucket %s: %o", bucket, error);
    }
  }
}
