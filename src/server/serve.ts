import { Command, Option } from "commander";
import Debug from "debug";
import jwt from "jsonwebtoken";
import cluster from "node:cluster";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { availableParallelism } from "node:os";
import { Server, Socket } from "socket.io";
import { DataSource } from "typeorm";

import { S3Client } from "@aws-sdk/client-s3";
import { createAdapter, setupPrimary } from "@socket.io/cluster-adapter";
import sticky from "@socket.io/sticky";

import { Controller } from "../controller.js";
import { getDataSource } from "../data-source.js";
import { _Server } from "../socket.js";
import { UnauthorizedError } from "../utils/errors.js";
import { Payload } from "../utils/payload.js";
import { makeS3Client, requireBucketName } from "../utils/storage.js";
import { DownloadServer } from "./download-server.js";
import { UploadServer } from "./upload-server.js";

// Allow socket to store payload
declare module "socket.io" {
  interface Socket extends ExtendedSocket { }
  interface Server extends ExtendedServer { }
}
interface ExtendedSocket {
  bucket: string;
  payload: Payload;
}
interface ExtendedServer {
  s3: S3Client;
  controller: Controller;
}

const debug = Debug("serve");

export const makeServeCommand = () => {
  const command = new Command(`serve`);
  command
    .requiredOption("--port <number>", "Port to listen on")
    .requiredOption(
      "--public-key-file <path>",
      "Path to the public key file generated with `openssl ec -in key.pem -pubout`"
    )
    .addOption(
      new Option("--database-type <type>", "Which type of database to use")
        .choices(["sqlite", "postgres"])
        .default("sqlite")
    )
    .requiredOption(
      "--connection-string <path>",
      "Connection string to the database"
    )
    .addOption(
      new Option(
        "--num-threads <number>",
        "Number of concurrent upload threads"
      ).default(availableParallelism())
    )
    .action(async () => {
      const options = command.opts();
      const port: number = parseInt(options["port"], 10);
      if (Number.isNaN(port)) {
        throw new Error(`"port" is not an integer`);
      }
      const publicKeyFile = options["publicKeyFile"];
      if (typeof publicKeyFile !== "string") {
        throw new Error("publicKeyFile must be a string");
      }
      const publicKey = readFileSync(publicKeyFile, "utf8");
      const dataSource = await getDataSource(
        options["databaseType"],
        options["connectionString"],
        options["debug"]
      );
      const controller = new Controller(dataSource);
      serve(port, publicKey, controller, parseInt(options["numThreads"], 10));
    });
  return command;
};

const serve = (
  port: number,
  publicKey: string,
  controller: Controller,
  numThreads: number
) => {
  // Exit on unhandled error
  process.on("unhandledRejection", (error) => {
    console.error(error);
    process.exit(1);
  });

  const httpServer = createServer();
  if (cluster.isPrimary) {
    debug(`start primary ${process.pid}`);

    sticky.setupMaster(httpServer, {
      loadBalancingMethod: "least-connection",
    });
    setupPrimary();
    cluster.setupPrimary({
      serialization: "advanced",
    });

    for (let i = 0; i < numThreads; i++) {
      cluster.fork();
    }
    cluster.on("exit", (worker) => {
      debug(`exit process ${worker.process.pid}`);
      cluster.fork();
    });

    httpServer.listen(port);
    return;
  }

  debug(`start worker ${process.pid}`);

  const io: _Server = new Server(httpServer);
  // Cluster adapter
  io.adapter(createAdapter());
  // Connection with the primary process
  sticky.setupWorker(io);

  // Set up socket.io
  io.s3 = makeS3Client();
  io.controller = controller;

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

  const downloadServer: DownloadServer = new DownloadServer(io);
  const uploadServer: UploadServer = new UploadServer(io);

  io.on("connection", (socket: Socket) => {
    switch (socket.payload.type) {
      case "download":
        downloadServer.listen(socket);
        break;
      case "upload":
        uploadServer.listen(socket);
        break;
    }
  });
};
