import Joi, { ObjectSchema } from "joi";

import { client, requestOptions } from "../../utils/http-client.js";
import { AuthorizeAccountResponse } from "./authorize-account.js";

import type { OptionsOfJSONResponseBody } from "got";
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
