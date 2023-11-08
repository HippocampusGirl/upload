import Joi from "joi";

import { ValidationError } from "./errors.js";

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
