import Joi, { ObjectSchema } from "joi";

import { client, requestOptions } from "../../utils/http-client.js";
import { AuthorizeAccountResponse } from "./authorize-account.js";
import { FileVersion } from "./head-file-by-name.js";

import type { OptionsOfJSONResponseBody } from "got";
interface DeleteFileVersionRequest extends FileVersion {
  bypassGovernance: false;
}
const deleteFileVersionRequestSchema: ObjectSchema<DeleteFileVersionRequest> =
  Joi.object({
    fileName: Joi.string().required(),
    fileId: Joi.string().required(),
    bypassGovernance: Joi.boolean().valid(false).required(),
  });
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
  const json = Joi.attempt(
    {
      fileName,
      fileId,
      bypassGovernance: false,
    },
    deleteFileVersionRequestSchema
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
  const deleteFileVersionResponse = Joi.attempt(
    response.body,
    deleteFileVersionResponseSchema
  );
  return deleteFileVersionResponse;
};
