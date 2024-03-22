import Joi, { ObjectSchema } from "joi";

import { client, requestOptions } from "../../utils/http-client.js";

import type { OptionsOfJSONResponseBody } from "got";

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
