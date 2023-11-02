import { isCelebrateError } from "celebrate";
import cors from "cors";
import { download } from "./download.js";
import { port } from "./environment.js";
import { AuthenticationError } from "./errors.js";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import { token } from "./token.js";
import { upload } from "./upload.js";

// Set up express
export const app = express();
app.use(cors());
app.use(express.json());
app.use(helmet());
app.use(morgan("combined"));

// Health check
app.get("/", (request: Request, response: Response, next: NextFunction) => {
  response.json({});
  next();
});

// Routers
app.use("/", download);
app.use("/", upload);
app.use("/", token);

// Send not found status codes
app.use((request: Request, response: Response, next: NextFunction) => {
  response.status(404).end();
  next();
});
// Send errors as JSON
app.use(
  (error: Error, request: Request, response: Response, next: NextFunction) => {
    if (
      error instanceof AuthenticationError ||
      error instanceof jwt.JsonWebTokenError ||
      error instanceof jwt.NotBeforeError ||
      error instanceof jwt.TokenExpiredError
    ) {
      response.status(401).json({ error: error.message }).end();
    } else if (isCelebrateError(error)) {
      let message = error.message;
      const details: string | undefined = error.details.get("body")?.message;
      if (details !== undefined) {
        message = `${message}: ${details}`;
      }
      response.status(400).json({ error: message }).end();
    } else {
      response.status(500).json({ error: error.message }).end();
    }
    next();
  }
);

// Start server
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
