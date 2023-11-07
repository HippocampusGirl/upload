import dotenv from "dotenv";

dotenv.config();

export const getS3Config = () => {
  if (typeof process.env.ENDPOINT !== "string") {
    throw new Error(`"process.env.ENDPOINT" needs to be a string`);
  }
  const endpoint: string = process.env.ENDPOINT;
  if (typeof process.env.ACCESS_KEY_ID !== "string") {
    throw new Error(`"process.env.ACCESS_KEY_ID" needs to be a string`);
  }
  const accessKeyId: string = process.env.ACCESS_KEY_ID;
  if (typeof process.env.SECRET_ACCESS_KEY !== "string") {
    throw new Error(`"process.env.SECRET_ACCESS_KEY" needs to be a string`);
  }
  const secretAccessKey: string = process.env.SECRET_ACCESS_KEY;
  return { endpoint, accessKeyId, secretAccessKey };
};

export const signedUrlOptions = { expiresIn: 60 * 60 };
export const keyRegExp = /^[a-z][a-z0-9-_/\.]+[a-z0-9]$/;
export const delimiter = "/";
