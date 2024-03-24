import TTLCache from "@isaacs/ttlcache";

import { S3Storage } from "../s3.js";
import { expiresIn } from "../ttl.js";
import { authorizeAccount, AuthorizeAccountResponse } from "./authorize-account.js";
import { createBucket } from "./create-bucket.js";
import { deleteFileVersion } from "./delete-file.js";
import { getDownloadUrl } from "./download-file-by-name.js";
import { getDownloadAuthorizationToken } from "./get-download-authorization.js";
import { headFileByName } from "./head-file-by-name.js";
import { getBucketId } from "./list-buckets.js";

const cacheOptions = {
  max: 10000,
  ttl: expiresIn * 1000,
};
const authorizeAccountResponseCache: TTLCache<
  string,
  AuthorizeAccountResponse
> = new TTLCache(cacheOptions);
const downloadAuthorizationTokenCache: TTLCache<string, string> = new TTLCache(
  cacheOptions
);
export class B2Storage extends S3Storage {
  get authorizeAccountResponse(): Promise<AuthorizeAccountResponse> {
    const { accessKeyId, secretAccessKey } = this.storageProvider;
    const cached = authorizeAccountResponseCache.get(accessKeyId);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    return authorizeAccount(accessKeyId, secretAccessKey);
  }

  override async createBucket(bucket: string): Promise<unknown> {
    return createBucket(await this.authorizeAccountResponse, bucket);
  }

  async getDownloadAuthorizationToken(bucket: string): Promise<string> {
    const cached = downloadAuthorizationTokenCache.get(bucket);
    if (cached !== undefined) {
      return cached;
    }
    const authorizeAccountResponse = await this.authorizeAccountResponse;
    const bucketId = await getBucketId(authorizeAccountResponse, bucket);
    return getDownloadAuthorizationToken(
      authorizeAccountResponse,
      bucketId,
      ""
    );
  }
  override async getAPIDownloadUrl(
    bucket: string,
    key: string
  ): Promise<string> {
    const authorizeAccountResponse = await this.authorizeAccountResponse;
    const authorizationToken = await this.getDownloadAuthorizationToken(bucket);
    const { downloadUrl } = authorizeAccountResponse.apiInfo.storageApi;
    return getDownloadUrl(downloadUrl, bucket, key, authorizationToken);
  }
  override async deleteFile(bucket: string, key: string): Promise<unknown> {
    const authorizeAccountResponse = await this.authorizeAccountResponse;
    const fileVersion = await headFileByName(
      authorizeAccountResponse,
      bucket,
      key
    );
    if (fileVersion === null) {
      throw new Error(`Could not find file ${bucket}/${key}`);
    }
    return deleteFileVersion(authorizeAccountResponse, fileVersion);
  }
}
