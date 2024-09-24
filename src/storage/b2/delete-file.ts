import Joi, { ObjectSchema } from "joi";

import { AuthorizeAccountResponse } from "./authorize-account.js";
import { FileVersion } from "./head-file-by-name.js";

import { IncomingHttpHeaders } from "node:http";
import undici from "undici";
interface DeleteFileVersionRequest extends FileVersion {
  bypassGovernance: false;
}
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
  const headers: IncomingHttpHeaders = { Authorization: authorizationToken };
  const json: DeleteFileVersionRequest = {
    fileName,
    fileId,
    bypassGovernance: false,
  };
  const body = JSON.stringify(json);
  const data = await undici.request(url, { method: "POST", headers, body });
  const deleteFileVersionResponse = Joi.attempt(
    await data.body.json(),
    deleteFileVersionResponseSchema
  );
  return deleteFileVersionResponse;
};
