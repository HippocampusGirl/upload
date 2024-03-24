import { digest } from "../utils/hash.js";

const delimiter = "-";
export const prefix = "upload";
export const getSuffix = async (accessKeyId: string): Promise<string> => {
  const suffix = (await digest(accessKeyId)).slice(0, 16);
  return suffix;
};
export const getBucketName = async (
  name: string,
  accessKeyId: string
): Promise<string> => {
  const suffix = await getSuffix(accessKeyId);
  return [prefix, name, suffix].join(delimiter);
};
