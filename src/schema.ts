import Joi from "joi";

import { ValidationError } from "./errors.js";

export const CloudflareBucketLocationConstraint = {
  wnam: "wnam",
  enam: "enam",
  weur: "weur",
  eeur: "eeur",
  apac: "apac",
};
export type CloudflareBucketLocationConstraint =
  keyof typeof CloudflareBucketLocationConstraint;

export type Type = "download" | "upload";
export interface Payload {
  type: Type;
  name: string;
  loc?: CloudflareBucketLocationConstraint;
}

export const payloadSchema = Joi.object({
  type: Joi.string().valid("download", "upload").required(),
  name: Joi.string().alphanum().case("lower").required(),
  loc: Joi.string().valid(...Object.keys(CloudflareBucketLocationConstraint)),
});

export const validate = (schema: Joi.Schema, value: any): any => {
  const { error, value: validated } = schema.validate(value);
  if (error !== undefined) {
    let message = error.message;
    const details: string | undefined = error.details
      .map((d) => d.message)
      .join(", ");
    if (details !== undefined) {
      message = `${message}: ${details}`;
    }
    throw new ValidationError(message);
  }
  return validated;
};
