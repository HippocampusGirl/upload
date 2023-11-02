import { compare } from "bcrypt";
import { celebrate, Joi, Segments } from "celebrate";
import { AuthenticationError } from "./errors.js";
import { password, jwtSecret } from "./environment.js";
import { NextFunction, Request, Response, Router } from "express";
import jwt from "jsonwebtoken";

export const token = Router();

// Create tokens
const payloadSchema = Joi.object({
  type: Joi.string().valid("download", "upload").required(),
  name: Joi.string().alphanum().case("lower").required(),
});
token.post(
  "/token",
  celebrate({
    [Segments.BODY]: Joi.object().keys({
      Password: Joi.string().required(),
      Payload: payloadSchema.required(),
    }),
  }),
  async (request: Request, response: Response, next: NextFunction) => {
    if (!(await compare(request.body.Password, password))) {
      return next(new AuthenticationError("Invalid password"));
    }
    const token = jwt.sign(request.body.Payload, jwtSecret);
    return response.json({ token });
  }
);
