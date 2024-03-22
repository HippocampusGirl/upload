import Debug from "debug";

import { S3Client } from "@aws-sdk/client-s3";

import { authorizeAccount, AuthorizeAccountResponse } from "./authorize-account.js";
import { createBucket } from "./create-bucket.js";
import { deleteFileVersion } from "./delete-file.js";
import { getDownloadUrl } from "./download-file-by-name.js";
import { getDownloadAuthorizationToken } from "./get-download-authorization.js";
import { headFileByName } from "./head-file-by-name.js";
import { getBucketId } from "./list-buckets.js";

const debug = Debug("storage");

const getCredentials = async (
  s3: S3Client
): Promise<AuthorizeAccountResponse> => {
  const { accessKeyId, secretAccessKey } = await s3.config.credentials();
  const authorizeAccountResponse = await authorizeAccount(
    accessKeyId,
    secretAccessKey
  );
  return authorizeAccountResponse;
};

export const createB2Bucket = async (
  s3: S3Client,
  bucket: string
): Promise<void> => {
  try {
    const authorizeAccountResponse = await getCredentials(s3);
    await createBucket(authorizeAccountResponse, bucket);
  } catch (error) {
    debug("failed to create bucket %o: %O", bucket, error);
    throw new Error("Failed to create bucket");
  }
};
export const getB2FileDownloadUrl = async (
  s3: S3Client,
  bucket: string,
  key: string
): Promise<URL> => {
  const authorizeAccountResponse = await getCredentials(s3);
  const bucketId = await getBucketId(authorizeAccountResponse, bucket);
  const authorizationToken = await getDownloadAuthorizationToken(
    authorizeAccountResponse,
    bucket,
    key
  );
  return getDownloadUrl(authorizationToken, bucketId, key, authorizationToken);
};
export const deleteB2File = async (
  s3: S3Client,
  bucket: string,
  key: string
): Promise<void> => {
  const authorizeAccountResponse = await getCredentials(s3);
  const fileVersion = await headFileByName(
    authorizeAccountResponse,
    bucket,
    key
  );
  if (fileVersion === null) {
    throw new Error(`File ${bucket} ${key} not found`);
  }
  await deleteFileVersion(authorizeAccountResponse, fileVersion);
};
