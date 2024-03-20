import Joi from "joi";

export const CloudflareBucketLocationConstraint = {
  wnam: "wnam",
  enam: "enam",
  weur: "weur",
  eeur: "eeur",
  apac: "apac",
};
export type CloudflareBucketLocationConstraint =
  keyof typeof CloudflareBucketLocationConstraint;

export interface Payload {
  type: "download" | "upload";
  name: string;
  loc?: CloudflareBucketLocationConstraint;
}

export const nameSchema = Joi.string().alphanum().case("lower");
export const payloadSchema = Joi.object({
  type: Joi.string().valid("download", "upload").required(),
  name: nameSchema.required(),
  loc: Joi.string().valid(...Object.keys(CloudflareBucketLocationConstraint)),
});
