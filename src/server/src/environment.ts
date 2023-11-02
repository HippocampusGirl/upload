import dotenv from "dotenv";
dotenv.config();

if (typeof process.env.PORT !== "string") {
  throw new Error(`"process.env.PORT" needs to be a string`);
}
if (process.env.PORT === "") {
  throw new Error(`"process.env.PORT" can't be empty`);
}
export const port: number = Number(process.env.PORT);
if (!Number.isInteger(port) || port === null) {
  throw new Error(`"process.env.PORT" is not an integer`);
}

if (typeof process.env.JWT_SECRET !== "string") {
  throw new Error(`"process.env.JWT_SECRET" needs to be a string`);
}
export const jwtSecret: string = process.env.JWT_SECRET;

if (typeof process.env.PASSWORD !== "string") {
  throw new Error(`"process.env.PASSWORD" needs to be a string`);
}
export const password: string = process.env.PASSWORD;

if (typeof process.env.ENDPOINT !== "string") {
  throw new Error(`"process.env.ENDPOINT" needs to be a string`);
}
export const endpoint: string = process.env.ENDPOINT;
if (typeof process.env.ACCESS_KEY_ID !== "string") {
  throw new Error(`"process.env.ACCESS_KEY_ID" needs to be a string`);
}
export const accessKeyId: string = process.env.ACCESS_KEY_ID;
if (typeof process.env.SECRET_ACCESS_KEY !== "string") {
  throw new Error(`"process.env.SECRET_ACCESS_KEY" needs to be a string`);
}
export const secretAccessKey: string = process.env.SECRET_ACCESS_KEY;
