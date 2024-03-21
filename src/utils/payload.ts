import Joi from 'joi';

export interface UploadPayload {
  t: "u";
  n: string;
  s: string;
}
interface DownloadPayload {
  t: "d";
}
export type Payload = UploadPayload | DownloadPayload;

export const nameSchema = Joi.string().alphanum().case("lower");
export const uploadPayloadSchema = Joi.object({
  t: Joi.string().valid("u").required(),
  n: nameSchema.required(),
  s: nameSchema.required(),
  iat: Joi.number().integer(),
});
export const downloadPayloadSchema = Joi.object({
  t: Joi.string().valid("d").required(),
  iat: Joi.number().integer(),
});
export const payloadSchema = Joi.alternatives(
  uploadPayloadSchema,
  downloadPayloadSchema
);
