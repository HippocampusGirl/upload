import Joi, { ObjectSchema } from "joi";

import { IncomingHttpHeaders } from "node:http";
import undici from "undici";
import { expiresIn } from "../ttl.js";
import { AuthorizeAccountResponse } from "./authorize-account.js";

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
  const headers: IncomingHttpHeaders = { Authorization: authorizationToken };
  const json: GetDownloadAuthorizationRequest = {
    bucketId,
    fileNamePrefix,
    validDurationInSeconds: expiresIn,
  };
  const body = JSON.stringify(json);
  const data = await undici.request(url, { method: "POST", headers, body });
  const getDownloadAuthorizationResponse = Joi.attempt(
    await data.body.json(),
    getDownloadAuthorizationResponseSchema
  );
  return getDownloadAuthorizationResponse.authorizationToken;
};
