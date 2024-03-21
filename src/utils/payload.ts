import Joi from "joi";

export interface UploadPayload {
  t: "u",
  n: string,
  s: string,
}
interface DownloadPayload {
  t: "d",
}
export type Payload = UploadPayload | DownloadPayload;

export const nameSchema = Joi.string().alphanum().case("lower");
export const payloadSchema = Joi.object({
  type: Joi.string().valid("d", "u").required(),
  name: nameSchema.required(),
  s: nameSchema.required(),
});
