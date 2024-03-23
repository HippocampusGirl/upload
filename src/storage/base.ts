import { parseTemplate } from "url-template";

import { _Object, HeadBucketCommand } from "@aws-sdk/client-s3";

import { StorageProvider } from "../entity/storage-provider.js";
import { getBucketName } from "./bucket-name.js";

export interface _BucketObject extends _Object {
  Bucket: string;
}

export abstract class Storage {
  storageProvider: StorageProvider;

  constructor(storageProvider: StorageProvider) {
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
    const bucket = getBucketName(n, accessKeyId);
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
    if (this.storageProvider.downloadUrlTemplate) {
      const template = this.storageProvider.downloadUrlTemplate!;
      const downloadUrl = parseTemplate(template).expand(
        await this.getTemplateContext(bucket, key)
      );
      return Promise.resolve(downloadUrl);
    }
    return this.getAPIDownloadUrl(bucket, key);
  }
  getTemplateContext(
    bucket: string,
    key: string
  ): Promise<Record<string, string>> {
    return Promise.resolve({ bucket, key });
  }
  abstract getAPIDownloadUrl(bucket: string, key: string): Promise<string>;
  abstract deleteFile(bucket: string, key: string): Promise<unknown>;

  abstract listObjects(): AsyncGenerator<_BucketObject, void, undefined>;
}
