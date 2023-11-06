import Debug from "debug";
import { Socket } from "socket.io";

import {
  _Object,
  CreateBucketCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  ListObjectsCommand,
  ListObjectsCommandInput,
  S3Client
} from "@aws-sdk/client-s3";

import { getS3Config } from "./config.js";

const debug = Debug("storage");

export const makeS3Client = (): S3Client => {
  const { endpoint, accessKeyId, secretAccessKey } = getS3Config();
  return new S3Client({
    region: "auto",
    endpoint: `https://${endpoint}`,
    credentials: { accessKeyId, secretAccessKey },
  });
};

export const getBucketName = async (
  s3: S3Client,
  name: string
): Promise<string> => {
  const bucket = `upload-${name}`;
  const bucketInput = { Bucket: bucket };

  try {
    await s3.send(new HeadBucketCommand(bucketInput));
  } catch (error) {
    try {
      await s3.send(new CreateBucketCommand(bucketInput));
    } catch (error) {
      debug(error);
      throw new Error("Failed to create bucket");
    }
  }

  return bucket;
};

export const listObjectsInBucket = async (
  s3: S3Client,
  bucket: string
): Promise<_Object[]> => {
  let isTruncated = false;
  let objects: _Object[] = new Array();
  const input: ListObjectsCommandInput = {
    Bucket: bucket,
  };
  do {
    const output = await s3.send(new ListObjectsCommand(input));
    isTruncated = output.IsTruncated ?? false;
    input.Marker = output.NextMarker;
    objects = objects.concat(output.Contents ?? []);
  } while (isTruncated);
  return objects;
};

export const listObjects = async (s3: S3Client): Promise<_Object[]> => {
  const buckets = await s3.send(new ListBucketsCommand({})).then((output) =>
    output.Buckets?.reduce((previousValue, bucket) => {
      if (bucket.Name?.startsWith("upload-")) {
        previousValue.push(bucket.Name);
      }
      return previousValue;
    }, new Array<string>())
  );

  if (buckets === undefined) {
    throw new Error("No buckets found");
  }

  const objects = await Promise.all(
    buckets.map(async (bucket) => {
      return await listObjectsInBucket(s3, bucket);
    })
  );
  return objects.flat();
};
