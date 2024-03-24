import { _Object, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

import { getBucketName } from "./bucket-name.js";

export interface BucketObject extends _Object {
  Bucket: string;
}
export interface _StorageProvider {
  id: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketLocationConstraint: string | null;
  downloadUrlTemplate: string | null;

  s3: S3Client;
  isBackblaze: boolean;
}
export abstract class Storage {
  storageProvider: _StorageProvider;

  constructor(storageProvider: _StorageProvider) {
    this.storageProvider = storageProvider;
  }

  /**
   * Checks if a bucket with the specified name exists in storage.
   * If the bucket does not exist, it creates a new bucket with the given name.
   * Returns the name of the bucket.
   *
   * @param n - The name of the token.
   * @returns A Promise that resolves to the name of the bucket.
   */
  async requireBucketName(n: string): Promise<string> {
    const { s3 } = this.storageProvider;
    const { accessKeyId } = await s3.config.credentials();
    const bucket = await getBucketName(n, accessKeyId);
    const input = { Bucket: bucket };
    try {
      await s3.send(new HeadBucketCommand(input));
    } catch (error) {
      await this.createBucket(bucket);
    }
    return bucket;
  }

  abstract createBucket(bucket: string): Promise<unknown>;
  abstract getUploadUrl(bucket: string, key: string): Promise<string>;

  async getDownloadUrl(bucket: string, key: string): Promise<string> {
    const template = this.storageProvider.downloadUrlTemplate;
    if (template !== null) {
      return template.replaceAll("{bucket}", bucket).replaceAll("{key}", key);
    }
    return this.getAPIDownloadUrl(bucket, key);
  }
  abstract getAPIDownloadUrl(bucket: string, key: string): Promise<string>;
  abstract deleteFile(bucket: string, key: string): Promise<unknown>;

  abstract listObjects(): AsyncGenerator<BucketObject, void, undefined>;
}
