import Joi, { ObjectSchema } from "joi";

import { IncomingHttpHeaders } from "node:http";
import undici from "undici";
import { AuthorizeAccountResponse } from "./authorize-account.js";

export interface FileVersion {
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
  const headers: IncomingHttpHeaders = { Authorization: authorizationToken };
  const data = await undici.request(url, { method: "HEAD", headers });

  const { statusCode } = data;
  if (statusCode === 404) {
    return null;
  }

  const headfileName = data.headers["x-bz-file-name"];
  if (headfileName !== fileName) {
    throw new Error(
      `Expected file name ${fileName} but received ${headfileName}`
    );
  }
  const fileId = data.headers["x-bz-file-id"];
  const checksumSHA1 = data.headers["x-bz-content-sha1"];
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
