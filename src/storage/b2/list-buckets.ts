import Joi, { ObjectSchema } from "joi";

import { IncomingHttpHeaders } from "node:http";
import undici from "undici";
import { AuthorizeAccountResponse } from "./authorize-account.js";

interface ListBucketsRequest {
  accountId: string;
  bucketName: string;
}
interface Bucket {
  bucketId: string;
  bucketName: string;
}
const bucketSchema: ObjectSchema<Bucket> = Joi.object({
  bucketId: Joi.string().required(),
}).unknown();
interface ListBucketsResponse {
  buckets: Bucket[];
}
const listBucketsResponseSchema: ObjectSchema<ListBucketsResponse> = Joi.object(
  {
    buckets: Joi.array().items(bucketSchema).required(),
  }
).unknown();
const listBucket = async (
  authorizeAccountResponse: AuthorizeAccountResponse,
  bucketName: string
): Promise<ListBucketsResponse> => {
  const { apiInfo, authorizationToken, accountId } = authorizeAccountResponse;
  const apiUrl = apiInfo.storageApi.apiUrl;
  const url = new URL("b2api/v3/b2_list_buckets", apiUrl);
  const headers: IncomingHttpHeaders = { Authorization: authorizationToken };
  const json: ListBucketsRequest = { accountId, bucketName };
  const body = JSON.stringify(json);
  const data = await undici.request(url, { method: "POST", headers, body });
  const listBucketsResponse = Joi.attempt(
    await data.body.json(),
    listBucketsResponseSchema
  );
  return listBucketsResponse;
};
/**
 * Retrieves the bucket ID for the specified bucket name based on
 * https://github.com/Backblaze/b2-sdk-python/blob/ea8626bd27e34796745c6e434cd60432aeff927d/b2sdk/api.py#L354-L378
 * @param authorizeAccountResponse - The response from authorizing the B2 account.
 * @param bucketName - The name of the bucket.
 * @returns A Promise that resolves to the bucket ID.
 * @throws Error if the bucket with the specified name is not found.
 */
export const getBucketId = async (
  authorizeAccountResponse: AuthorizeAccountResponse,
  bucketName: string
): Promise<string> => {
  const listBucketsResponse = await listBucket(
    authorizeAccountResponse,
    bucketName
  );
  const bucket = listBucketsResponse.buckets.find(
    (bucket) => bucket.bucketName.toLowerCase() === bucketName.toLowerCase()
  );
  if (bucket === undefined) {
    throw new Error(`Bucket ${bucketName} not found`);
  }
  return bucket.bucketId;
};
