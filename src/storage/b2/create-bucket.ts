import Joi, { ObjectSchema } from "joi";

import { client, requestOptions } from "../../utils/http-client.js";
import { AuthorizeAccountResponse } from "./authorize-account.js";

import type { OptionsOfJSONResponseBody } from "got";
interface LifecycleRule {
  daysFromHidingToDeleting: number;
  daysFromUploadingToHiding: number | null;
  fileNamePrefix: string;
}
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
export const defaultServerSideEncryption: ServerSideEncryptionSetting = {
  mode: "SSE-B2",
  algorithm: "AES256",
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
  const json: CreateBucketRequest = {
    accountId,
    bucketName,
    bucketType: "allPrivate",
    bucketInfo: {},
    corsRules: [],
    fileLockEnabled: false,
    lifecycleRules: [keepOnlyLastVersion],
    replicationConfiguration: {},
    defaultServerSideEncryption,
  };
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
