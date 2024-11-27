import { digest } from "../utils/hash.js";

const delimiter = "-";
export const prefix = "upload";
export const getSuffix = async (accessKeyId: string): Promise<string> => {
  const suffix = (await digest(accessKeyId)).slice(0, 16);
  return suffix;
};
export const getBucketName = async (
  n: string,
  accessKeyId: string
): Promise<string> => {
  const suffix = await getSuffix(accessKeyId);
  return [prefix, n, suffix].join(delimiter);
};
export const parseBucketName = (bucket: string): string => {
  if (!bucket.startsWith(prefix)) {
    throw new Error(`Invalid bucket name: ${bucket}`);
  }
  const [_prefix, n, suffix] = bucket.split(delimiter);
  if (_prefix !== prefix) {
    throw new Error(`Invalid prefix for bucket name: "${bucket}"`);
  }
  if (n === undefined) {
    throw new Error(`Missing n in bucket name: "${bucket}"`);
  }
  if (suffix === undefined) {
    throw new Error(`Missing suffix in bucket name: "${bucket}"`);
  }
  return n;
};
