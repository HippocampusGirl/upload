import { Command, Option } from "commander";
import Debug from "debug";
import jwt from "jsonwebtoken";
import cluster, { Worker } from "node:cluster";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, Server as HttpServer } from "node:http";
import { availableParallelism } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Server as SocketServer, Socket } from "socket.io";
import msgpackParser from "socket.io-msgpack-parser";

import { S3Client } from "@aws-sdk/client-s3";
import { createAdapter, setupPrimary } from "@socket.io/cluster-adapter";
import sticky from "@socket.io/sticky";

import { Controller } from "../controller.js";
import { getDataSource } from "../data-source.js";
import { _Server } from "../socket.js";
import { requireBucketName } from "../storage/base.js";
import { UnauthorizedError } from "../utils/errors.js";
import { tsNodeArgv } from "../utils/loader.js";
import { Payload, UploadPayload } from "../utils/payload.js";
import { signal } from "../utils/signal.js";
import { DownloadServer } from "./download-server.js";
import { UploadServer } from "./upload-server.js";

// Allow socket to store payload
declare module "socket.io" {
  interface Socket extends ExtendedSocket {}
  interface Server extends ExtendedServer {}
}
interface ExtendedSocket {
  bucket: string;
  payload: Payload;
  s3: S3Client | undefined;
}
interface ExtendedServer {
  controller: Controller;
}

const debug = Debug("server");

export let server: Server | undefined;

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
      if (command.parent === null) {
        throw new Error("Command parent is null");
      }
      const args = command.parent.args;
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

      server = new Server(
        port,
        publicKey,
        controller,
        parseInt(options["numThreads"], 10),
        args.slice()
      );
      await server.serve();
    });
  return command;
};

export const restartWorker = (worker: Worker) => {
  debug(
    `exit process ${worker.process.pid} with exit code ${worker.process.exitCode}`
  );
  cluster.fork();
};

class Server {
  port: number;
  publicKey: string;
  controller: Controller;
  numThreads: number;
  args: string[];

  httpServer: HttpServer;
  workers: Worker[] = [];

  constructor(
    port: number,
    publicKey: string,
    controller: Controller,
    numThreads: number,
    args: string[]
  ) {
    this.port = port;
    this.publicKey = publicKey;
    this.controller = controller;
    this.numThreads = numThreads;
    this.args = args;

    process.on("unhandledRejection", (error: Error) => {
      debug("received unhandled promise rejection: %O", error);
    });

    this.httpServer = createServer();
  }
  async terminate(): Promise<void> {
    cluster.removeAllListeners("exit");
    for (const worker of this.workers) {
      worker.kill();
    }
    await promisify(cluster.disconnect)();
  }

  servePrimary(): Promise<unknown> {
    debug("start primary %o", process.pid);

    sticky.setupMaster(this.httpServer, {
      loadBalancingMethod: "least-connection",
    });
    setupPrimary();

    const servePath = fileURLToPath(import.meta.url);
    const extension = extname(servePath);
    const indexPath = join(dirname(servePath), `../index${extension}`);
    this.args.unshift(indexPath);

    if (extension == ".ts") {
      this.args.unshift(...tsNodeArgv);
    }
    cluster.setupPrimary({
      execArgv: this.args,
      serialization: "advanced",
    });

    for (let i = 0; i < this.numThreads; i++) {
      this.workers.push(cluster.fork());
    }
    cluster.on("exit", restartWorker);

    this.httpServer.listen(this.port);
    this.httpServer.on("error", (error: Error) => {
      debug("received error from http server: %O", error);
    });

    signal.finally(() => {
      this.httpServer.close();
      if (cluster.isPrimary) {
        this.terminate();
      }
    });

    return Promise.all(this.workers.map((worker) => once(worker, "online")));
  }

  serveWorker(): Promise<unknown> {
    debug("start worker %d", process.pid);

    const io: _Server = new SocketServer(this.httpServer, {
      parser: msgpackParser,
    });
    // Cluster adapter
    io.adapter(createAdapter());
    // Connection with the primary process
    sticky.setupWorker(io);
    // Setup server object
    io.controller = this.controller;

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
        payload = jwt.verify(token, this.publicKey, {});
      } catch (error) {
        debug("token verify failed with error %O", error);
        return next(new UnauthorizedError("Invalid token"));
      }
      if (payload === undefined || typeof payload !== "object") {
        return next(new UnauthorizedError("Invalid token payload"));
      }

      const { controller } = io;

      const { t } = payload as Payload;
      if (t === "u") {
        const { n, s } = payload as UploadPayload;
        const storageProvider = await controller.getStorageProvider(s);
        if (storageProvider === null) {
          return next(new UnauthorizedError("Invalid token storage provider"));
        }
        try {
          const { s3 } = storageProvider;
          socket.bucket = await requireBucketName(s3, n);
          socket.s3 = s3;
        } catch (error) {
          return next(new UnauthorizedError("Cannot create bucket for token"));
        }
        socket.payload = { t, n, s };
      } else if (t === "d") {
        socket.payload = { t };
        socket.join("download");
      }

      return next();
    });

    const downloadServer: DownloadServer = new DownloadServer(io);
    const uploadServer: UploadServer = new UploadServer(io);

    io.on("connection", (socket: Socket) => {
      switch (socket.payload.t) {
        case "d": // Download
          downloadServer.listen(socket);
          break;
        case "u": // Upload
          uploadServer.listen(socket);
          break;
      }
    });

    return Promise.resolve();
  }

  serve(): Promise<unknown> {
    if (cluster.isPrimary) {
      return this.servePrimary();
    } else if (cluster.isWorker) {
      return this.serveWorker();
    }
    return Promise.reject();
  }
}
