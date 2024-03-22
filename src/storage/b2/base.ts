import { S3Storage } from "../s3.js";
import { authorizeAccount, AuthorizeAccountResponse } from "./authorize-account.js";
import { createBucket } from "./create-bucket.js";
import { deleteFileVersion } from "./delete-file.js";
import { getDownloadUrl } from "./download-file-by-name.js";
import { getDownloadAuthorizationToken } from "./get-download-authorization.js";
import { headFileByName } from "./head-file-by-name.js";
import { getBucketId } from "./list-buckets.js";

export class B2Storage extends S3Storage {
  get authorizeAccountResponse(): Promise<AuthorizeAccountResponse> {
    return authorizeAccount(
      this.storageProvider.accessKeyId,
      this.storageProvider.secretAccessKey
    );
  }

  override async createBucket(bucket: string): Promise<unknown> {
    return createBucket(await this.authorizeAccountResponse, bucket);
  }
  override async getDownloadUrl(bucket: string, key: string): Promise<string> {
    const authorizeAccountResponse = await this.authorizeAccountResponse;
    const bucketId = await getBucketId(authorizeAccountResponse, bucket);
    const authorizationToken = await getDownloadAuthorizationToken(
      authorizeAccountResponse,
      bucket,
      key
    );
    return getDownloadUrl(
      authorizationToken,
      bucketId,
      key,
      authorizationToken
    );
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
