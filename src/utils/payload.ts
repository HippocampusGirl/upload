import Joi, { AlternativesSchema, ObjectSchema } from "joi";

export interface UploadPayload {
  t: "u";
  n: string;
  s: string;
}
interface DownloadPayload {
  t: "d";
}
export type Payload = UploadPayload | DownloadPayload;

const nameSchema = Joi.string().alphanum().case("lower");
export const uploadPayloadSchema: ObjectSchema<UploadPayload> = Joi.object({
  t: Joi.string().valid("u").required(),
  n: nameSchema.required(),
  s: nameSchema.required(),
}).unknown();
export const downloadPayloadSchema: ObjectSchema<DownloadPayload> = Joi.object({
  t: Joi.string().valid("d").required(),
}).unknown();
export const payloadSchema: AlternativesSchema<Payload> = Joi.alternatives(
  uploadPayloadSchema,
  downloadPayloadSchema
);
