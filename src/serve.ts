import { Command } from "commander";
import Debug from "debug";
import jwt from "jsonwebtoken";
import { readFileSync } from "node:fs";
import { Server, Socket } from "socket.io";

import { S3Client } from "@aws-sdk/client-s3";

import { DownloadServer } from "./download-server.js";
import { UnauthorizedError } from "./errors.js";
import { Payload } from "./payload.js";
import { _Server } from "./socket.js";
import { makeS3Client, requireBucketName } from "./storage.js";
import { UploadServer } from "./upload-server.js";

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

  uploadServer: UploadServer;
  downloadServer: DownloadServer;
}

const debug = Debug("serve");

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
      const port: number = parseInt(options.port, 10);
      if (Number.isNaN(port)) {
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
  const io: _Server = new Server(port);
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

    const { type, name, loc } = payload as Payload;
    socket.payload = { type, name };
    socket.bucket = await requireBucketName(io.s3, name, loc);

    socket.join(type);

    return next();
  });

  io.uploadServer = new UploadServer(io);
  io.downloadServer = new DownloadServer(io);
  io.on("connection", (socket: Socket) => {
    io.uploadServer.listen(socket);
    io.downloadServer.listen(socket);
  });

  // Exit on unhandled error
  process.on("unhandledRejection", (error) => {
    console.error(error);
    process.exit(1);
  });
};
