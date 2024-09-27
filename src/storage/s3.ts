import Debug from "debug";

import {
  _Object,
  BucketLocationConstraint,
  CreateBucketCommand,
  CreateBucketCommandInput,
  DeleteObjectCommand,
  GetObjectCommand,
  ListBucketsCommand,
  ListObjectsCommand,
  ListObjectsCommandInput,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { BucketObject, Storage } from "./base.js";
import { prefix } from "./bucket-name.js";
import { signedUrlOptions } from "./ttl.js";

const debug = Debug("storage");

export class S3Storage extends Storage {
  async createBucket(bucket: string): Promise<unknown> {
    const { s3, bucketLocationConstraint } = this.storageProvider;
    const input: CreateBucketCommandInput = { Bucket: bucket };
    if (bucketLocationConstraint) {
      input.CreateBucketConfiguration = {
        LocationConstraint:
          bucketLocationConstraint as BucketLocationConstraint,
      };
    }
    return s3.send(new CreateBucketCommand(input));
  }

  async getUploadUrl(bucket: string, key: string): Promise<string> {
    const { s3 } = this.storageProvider;
    const input = {
      Bucket: bucket,
      Key: key,
    };
    return getSignedUrl(s3, new PutObjectCommand(input), signedUrlOptions);
  }
  async getAPIDownloadUrl(bucket: string, key: string): Promise<string> {
    const { s3 } = this.storageProvider;
    const input = {
      Bucket: bucket,
      Key: key,
    };
    return getSignedUrl(s3, new GetObjectCommand(input), signedUrlOptions);
  }
  async deleteFile(bucket: string, key: string): Promise<unknown> {
    const { s3 } = this.storageProvider;
    const input = { Bucket: bucket, Key: key };
    return s3.send(new DeleteObjectCommand(input));
  }

  async *listObjectsInBucket(
    bucket: string
  ): AsyncGenerator<_Object, void, undefined> {
    const { s3 } = this.storageProvider;

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
        /* If the full list was not returned, we need to use either the
         * provided marker or the key of the last object that we retrieved
         * as per
         * https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjects.html#API_ListObjects_ResponseSyntax
         */
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
  async *listObjects(): AsyncGenerator<BucketObject, void, undefined> {
    const { id, s3 } = this.storageProvider;

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
    debug(
      'listing buckets %s for storage provider "%s"',
      buckets.join("|"),
      id
    );
    for (const bucket of buckets) {
      try {
        for await (const object of this.listObjectsInBucket(bucket)) {
          yield { ...object, Bucket: bucket };
        }
      } catch (error) {
        debug("failed to list objects in bucket %s: %o", bucket, error);
      }
    }
  }
}
