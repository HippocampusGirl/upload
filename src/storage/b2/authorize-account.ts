import Joi, { ObjectSchema } from "joi";
import { IncomingHttpHeaders } from "node:http";
import undici from "undici";

interface StorageApi {
  apiUrl: string;
  downloadUrl: string;
}
const storageApiSchema: ObjectSchema<StorageApi> = Joi.object({
  apiUrl: Joi.string().uri({ scheme: "https" }).required(),
  downloadUrl: Joi.string().uri({ scheme: "https" }).required(),
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

  const headers: IncomingHttpHeaders = {
    Authorization: `Basic ${btoa(applicationKeyId + ":" + ApplicationKey)}`,
  };
  const response = await undici.request(url, { method: "GET", headers });
  const authorizeAccountResponse = Joi.attempt(
    await response.body.json(),
    authorizeAccountResponseSchema
  );
  return authorizeAccountResponse;
};
