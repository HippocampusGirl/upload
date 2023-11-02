import { jwtSecret } from "./environment.js";
import { AuthenticationError } from "./errors.js";
import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload, VerifyErrors } from "jsonwebtoken";

// Unpack JWT tokens
export function unpack(
  callback: (
    request: Request,
    response: Response,
    next: NextFunction,
    payload: JwtPayload
  ) => void
): (request: Request, response: Response, next: NextFunction) => void {
  return async (request: Request, response: Response, next: NextFunction) => {
    jwt.verify(
      request.body.Token,
      jwtSecret,
      {},
      async (error: VerifyErrors | null, payload) => {
        if (error) {
          next(new AuthenticationError("Invalid token"));
          return;
        }
        if (payload === undefined || typeof payload !== "object") {
          next(new AuthenticationError("Invalid token payload"));
          return;
        }
        try {
          callback(request, response, next, payload);
        } catch (error) {
          next(error);
        }
      }
    );
  };
}

export const signedUrlOptions = { expiresIn: 7 * 24 * 60 * 60 };
