import Joi, { ObjectSchema } from "joi";

import { client, requestOptions } from "../../utils/http-client.js";
import { expiresIn } from "../ttl.js";
import { AuthorizeAccountResponse } from "./authorize-account.js";

import type { OptionsOfJSONResponseBodyWrapped } from "got";
interface GetDownloadAuthorizationRequest {
  bucketId: string;
  fileNamePrefix: string;
  validDurationInSeconds: number;
}
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
  const { apiInfo, authorizationToken } = authorizeAccountResponse;
  const apiUrl = apiInfo.storageApi.apiUrl;
  const url = new URL("b2api/v3/b2_get_download_authorization", apiUrl);
  const json: GetDownloadAuthorizationRequest = {
    bucketId,
    fileNamePrefix,
    validDurationInSeconds: expiresIn,
  };
  const options: OptionsOfJSONResponseBodyWrapped = {
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
