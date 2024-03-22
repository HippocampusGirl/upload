import { createHash } from "node:crypto";

export const prefix = "upload";

export const getBucketName = (name: string, accessKeyId: string): string => {
  const suffix = createHash("sha256")
    .update(accessKeyId, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `${prefix}-${name}-${suffix}`;
};
