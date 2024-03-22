import Debug from "debug";
import Joi, { ObjectSchema } from "joi";

import { S3Client } from "@aws-sdk/client-s3";

import { client, requestOptions } from "../utils/http-client.js";

import type {
  OptionsOfJSONResponseBody,
  OptionsOfUnknownResponseBody,
} from "got";
const debug = Debug("storage");

interface LifecycleRule {
  daysFromHidingToDeleting: number;
  daysFromUploadingToHiding: number | null;
  fileNamePrefix: string;
}
const lifecycleRuleSchema: ObjectSchema<LifecycleRule> = Joi.object({
  daysFromHidingToDeleting: Joi.number().required(),
  daysFromUploadingToHiding: Joi.number().allow(null).required(),
  fileNamePrefix: Joi.string().allow("").required(),
});
/**
 * Represents a lifecycle rule to keep only the last version of a file.
 * Copied from https://www.backblaze.com/docs/cloud-storage-lifecycle-rules
 */
export const keepOnlyLastVersion: LifecycleRule = {
  daysFromHidingToDeleting: 1,
  daysFromUploadingToHiding: null,
  fileNamePrefix: "",
};

interface ServerSideEncryptionSetting {
  mode: "SSE-B2";
  algorithm: "AES256";
}
const serverSideEncryptionSettingSchema: ObjectSchema<ServerSideEncryptionSetting> =
  Joi.object({
    mode: Joi.string().valid("SSE-B2").required(),
    algorithm: Joi.string().valid("AES256").required(),
  });
export const defaultServerSideEncryption: ServerSideEncryptionSetting = {
  mode: "SSE-B2",
  algorithm: "AES256",
};

interface StorageApi {
  apiUrl: string;
}
const storageApiSchema: ObjectSchema<StorageApi> = Joi.object({
  apiUrl: Joi.string().uri({ scheme: "https" }).required(),
}).unknown();
interface ApiInfo {
  storageApi: StorageApi;
}
const apiInfoSchema: ObjectSchema<ApiInfo> = Joi.object({
  storageApi: storageApiSchema.required(),
}).unknown();
export interface AuthorizeAccountResponse {
  accountId: string;
  authorizationToken: string;
  apiInfo: ApiInfo;
}
const authorizeAccountResponseSchema: ObjectSchema<AuthorizeAccountResponse> =
  Joi.object({
    accountId: Joi.string().required(),
    authorizationToken: Joi.string().required(),
    apiInfo: apiInfoSchema.required(),
  }).unknown();

const apiUrl: string = "https://api.backblazeb2.com";
export const authorizeAccount = async (
  applicationKeyId: string,
  ApplicationKey: string
): Promise<AuthorizeAccountResponse> => {
  const url = new URL("b2api/v3/b2_authorize_account", apiUrl);
  const options: OptionsOfJSONResponseBody = {
    ...requestOptions,
    url,
    headers: {
      Authorization: `Basic ${btoa(applicationKeyId + ":" + ApplicationKey)}`,
    },
    isStream: false,
    resolveBodyOnly: false,
    responseType: "json",
  };
  const response = await client.get(options);
  const authorizeAccountResponse = Joi.attempt(
    response.body,
    authorizeAccountResponseSchema
  );
  return authorizeAccountResponse;
};

interface CreateBucketRequest {
  accountId: string;
  bucketName: string;
  bucketType: "allPrivate";
  bucketInfo: Record<string, never>;
  corsRules: never[];
  fileLockEnabled: false;
  lifecycleRules: LifecycleRule[];
  replicationConfiguration: Record<string, never>;
  defaultServerSideEncryption: ServerSideEncryptionSetting;
}
const createBucketRequestSchema: ObjectSchema<CreateBucketRequest> = Joi.object(
  {
    accountId: Joi.string().required(),
    bucketName: Joi.string().required(),
    bucketType: Joi.string().valid("allPrivate").required(),
    bucketInfo: Joi.object().empty().required(),
    corsRules: Joi.array().empty().required(),
    fileLockEnabled: Joi.boolean().valid(false).required(),
    lifecycleRules: Joi.array().items(lifecycleRuleSchema),
    replicationConfiguration: Joi.object().empty().required(),
    defaultServerSideEncryption: serverSideEncryptionSettingSchema,
  }
);
interface CreateBucketResponse {
  options: "s3"[];
}
const createBucketResponseSchema: ObjectSchema<CreateBucketResponse> =
  Joi.object({
    options: Joi.array().items(Joi.string().valid("s3")).required(),
  }).unknown();
export const createBucket = async (
  authorizeAccountResponse: AuthorizeAccountResponse,
  bucketName: string
): Promise<CreateBucketResponse> => {
  const { apiInfo, authorizationToken, accountId } = authorizeAccountResponse;
  const apiUrl = apiInfo.storageApi.apiUrl;
  const url = new URL("b2api/v3/b2_create_bucket", apiUrl);
  const json = Joi.attempt(
    {
      accountId,
      bucketName,
      bucketType: "allPrivate",
      bucketInfo: {},
      corsRules: [],
      fileLockEnabled: false,
      lifecycleRules: [keepOnlyLastVersion],
      replicationConfiguration: {},
      defaultServerSideEncryption,
    },
    createBucketRequestSchema
  );
  const options: OptionsOfJSONResponseBody = {
    ...requestOptions,
    url,
    json,
    headers: {
      Authorization: authorizationToken,
    },
    isStream: false,
    resolveBodyOnly: false,
    responseType: "json",
  };
  const response = await client.post(options);
  const createBucketResponse = Joi.attempt(
    response.body,
    createBucketResponseSchema
  );
  return createBucketResponse;
};

interface FileVersion {
  fileName: string;
  fileId: string;
}
interface HeadFileByNameResponse extends FileVersion {
  checksumSHA1: string;
}
const headFileByNameResponseSchema: ObjectSchema<HeadFileByNameResponse> =
  Joi.object({
    fileName: Joi.string().required(),
    fileId: Joi.string().required(),
    checksumSHA1: Joi.string().required(),
  }).unknown();
/**
 * Retrieves the metadata of a file by its name from a specific bucket
 * using an undocumented HEAD request as per
 * https://github.com/Backblaze/b2-sdk-python/issues/143#issuecomment-657411328
 *
 * @param authorizeAccountResponse - The response object containing the account authorization information.
 * @param bucketName - The name of the bucket where the file is located.
 * @param fileName - The name of the file to retrieve.
 * @returns A promise that resolves to the metadata of the file, or null if the file does not exist.
 * @throws An error if the retrieved file name does not match the expected file name.
 */
export const headFileByName = async (
  authorizeAccountResponse: AuthorizeAccountResponse,
  bucketName: string,
  fileName: string
): Promise<HeadFileByNameResponse | null> => {
  const { apiInfo, authorizationToken } = authorizeAccountResponse;
  const apiUrl = apiInfo.storageApi.apiUrl;
  const url = new URL(`/file/${bucketName}/${fileName}`, apiUrl);
  const options: OptionsOfUnknownResponseBody = {
    ...requestOptions,
    url,
    headers: {
      Authorization: authorizationToken,
    },
    isStream: false,
    resolveBodyOnly: false,
  };
  const response = await client.head(options);
  if (response.statusCode === 404) {
    return null;
  }
  const headfileName = response.headers["x-bz-file-name"];
  if (headfileName !== fileName) {
    throw new Error(
      `Expected file name ${fileName} but received ${headfileName}`
    );
  }
  const fileId = response.headers["x-bz-file-id"];
  const checksumSHA1 = response.headers["x-bz-content-sha1"];
  const headFileByNameResponse = Joi.attempt(
    {
      fileName,
      fileId,
      checksumSHA1,
    },
    headFileByNameResponseSchema
  );
  return headFileByNameResponse;
};

interface DeleteFileVersionRequest extends FileVersion {
  bypassGovernance: false;
}
const deleteFileVersionRequestSchema: ObjectSchema<DeleteFileVersionRequest> =
  Joi.object({
    fileName: Joi.string().required(),
    fileId: Joi.string().required(),
    bypassGovernance: Joi.boolean().valid(false).required(),
  });
interface DeleteFileVersionResponse extends FileVersion {}
const deleteFileVersionResponseSchema: ObjectSchema<DeleteFileVersionResponse> =
  Joi.object({
    fileName: Joi.string().required(),
    fileId: Joi.string().required(),
  }).unknown();
export const deleteFileVersion = async (
  authorizeAccountResponse: AuthorizeAccountResponse,
  fileVersion: FileVersion
): Promise<DeleteFileVersionResponse> => {
  const { apiInfo, authorizationToken } = authorizeAccountResponse;
  const apiUrl = apiInfo.storageApi.apiUrl;
  const url = new URL("b2api/v3/b2_delete_file_version", apiUrl);
  const { fileName, fileId } = fileVersion;
  const json = Joi.attempt(
    {
      fileName,
      fileId,
      bypassGovernance: false,
    },
    deleteFileVersionRequestSchema
  );
  const options: OptionsOfJSONResponseBody = {
    ...requestOptions,
    url,
    json,
    headers: {
      Authorization: authorizationToken,
    },
    isStream: false,
    resolveBodyOnly: false,
    responseType: "json",
  };
  const response = await client.post(options);
  const deleteFileVersionResponse = Joi.attempt(
    response.body,
    deleteFileVersionResponseSchema
  );
  return deleteFileVersionResponse;
};

export const createB2Bucket = async (
  s3: S3Client,
  bucket: string
): Promise<void> => {
  const { accessKeyId, secretAccessKey } = await s3.config.credentials();
  try {
    const authorizeAccountResponse = await authorizeAccount(
      accessKeyId,
      secretAccessKey
    );
    await createBucket(authorizeAccountResponse, bucket);
  } catch (error) {
    debug("failed to create bucket %o: %O", bucket, error);
    throw new Error("Failed to create bucket");
  }
};
export const deleteB2File = async (
  s3: S3Client,
  bucket: string,
  key: string
): Promise<void> => {
  const { accessKeyId, secretAccessKey } = await s3.config.credentials();
  const authorizeAccountResponse = await authorizeAccount(
    accessKeyId,
    secretAccessKey
  );
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
