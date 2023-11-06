import { Command } from "commander";
import jwt from "jsonwebtoken";
import { readFileSync } from "node:fs";
import { Server, Socket } from "socket.io";

import { S3Client } from "@aws-sdk/client-s3";

import { UnauthorizedError } from "./errors.js";
import { Payload } from "./schema.js";
import { getBucketName, makeS3Client } from "./storage.js";
import { registerUploadHandlers } from "./upload-server.js";

// Allow socket to store payload
declare module "socket.io" {
  interface Socket extends ExtendedSocket {}
  interface Server extends ExtendedServer {}
}
interface ExtendedSocket {
  bucket: string;
  payload: Payload;
}
interface ExtendedServer {
  s3: S3Client;
}

export const makeServeCommand = () => {
  const command = new Command("serve");
  command
    .requiredOption("--port <number>", "Port to listen on")
    .requiredOption(
      "--public-key-file <path>",
      "Path to the public key file generated with `openssl ec -in key.pem -pubout`"
    )
    .action(() => {
      const options = command.opts();
      const port: number = Number(options.port);
      if (!Number.isInteger(port) || port === null) {
        throw new Error(`"port" is not an integer`);
      }
      const publicKeyFile = options.publicKeyFile;
      if (typeof publicKeyFile !== "string") {
        throw new Error("publicKeyFile must be a string");
      }
      const publicKey = readFileSync(publicKeyFile, "utf8");
      serve(port, publicKey);
    });
  return command;
};

export const serve = (port: number, publicKey: string) => {
  // Set up socket.io
  const io = new Server(port);
  io.s3 = makeS3Client();

  // Handle authorization
  // based on socketio-jwt/src/authorize.ts
  io.use(async (socket, next) => {
    const handshake = socket.handshake;
    const { token } = handshake.auth;
    if (token === undefined) {
      return next(new UnauthorizedError("Missing authorization token"));
    }
    if (typeof token !== "string") {
      return next(
        new UnauthorizedError("Authorization token needs to be string")
      );
    }
    let payload;
    try {
      payload = jwt.verify(token, publicKey, {});
    } catch (error) {
      return next(new UnauthorizedError("Invalid token"));
    }
    if (payload === undefined || typeof payload !== "object") {
      return next(new UnauthorizedError("Invalid token payload"));
    }

    const { type, name } = payload;
    socket.payload = { type, name };
    socket.bucket = await getBucketName(io.s3, name);

    return next();
  });

  io.on("connection", (socket: Socket) => {
    registerUploadHandlers(io, socket);
  });

  // Exit on unhandled error
  process.on("unhandledRejection", (error) => {
    console.error(error);
    process.exit(1);
  });
};
