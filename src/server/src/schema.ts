import { Joi } from "celebrate";

export const tokenSchema = Joi.object().keys({
  Token: Joi.string().required(),
});
export const fileSchema = tokenSchema.keys({
  Key: Joi.string()
    .pattern(/^[a-z][a-z0-9-_/\.]+[a-z0-9]$/)
    .required(),
});
