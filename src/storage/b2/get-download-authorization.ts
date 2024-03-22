import Joi, { ObjectSchema } from "joi";

import { expiresIn } from "../../config.js";
import { client, requestOptions } from "../../utils/http-client.js";
import { AuthorizeAccountResponse } from "./authorize-account.js";

import type { OptionsOfJSONResponseBody } from "got";
interface GetDownloadAuthorizationRequest {
  bucketId: string;
  fileNamePrefix: string;
  validDurationInSeconds: number;
}
const getDownloadAuthorizationRequestSchema: ObjectSchema<GetDownloadAuthorizationRequest> =
  Joi.object({
    bucketId: Joi.string().required(),
    fileNamePrefix: Joi.string().required(),
    validDurationInSeconds: Joi.number().min(1).max(604800).required(),
  });
interface GetDownloadAuthorizationResponse {
  authorizationToken: string;
}
const getDownloadAuthorizationResponseSchema: ObjectSchema<GetDownloadAuthorizationResponse> =
  Joi.object({
    authorizationToken: Joi.string().required(),
  }).unknown();
export const getDownloadAuthorizationToken = async (
  authorizeAccountResponse: AuthorizeAccountResponse,
  bucketId: string,
  fileNamePrefix: string
): Promise<string> => {
  const { apiInfo, authorizationToken, accountId } = authorizeAccountResponse;
  const apiUrl = apiInfo.storageApi.apiUrl;
  const url = new URL("b2api/v3/b2_get_download_authorization", apiUrl);
  const json = Joi.attempt(
    { accountId, bucketId, fileNamePrefix, validDurationInSeconds: expiresIn },
    getDownloadAuthorizationRequestSchema
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
  const getDownloadAuthorizationResponse = Joi.attempt(
    response.body,
    getDownloadAuthorizationResponseSchema
  );
  return getDownloadAuthorizationResponse.authorizationToken;
};
