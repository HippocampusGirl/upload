import { Command, Option } from "commander";
import Debug from "debug";
import cluster, { Worker } from "node:cluster";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, Server as HttpServer } from "node:http";
import { availableParallelism } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Socket, Server as SocketServer } from "socket.io";
import msgpackParser from "socket.io-msgpack-parser";

import { createAdapter, setupPrimary } from "@socket.io/cluster-adapter";
import sticky from "@socket.io/sticky";
import { decode, JwtData, verify } from "@tsndr/cloudflare-worker-jwt";

import { Controller } from "../controller.js";
import { getDataSource } from "../entity/data-source.js";
import { UnauthorizedError } from "../errors.js";
import { _Server } from "../socket.js";
import { Storage } from "../storage/base.js";
import { tsNodeArgv } from "../utils/loader.js";
import { Payload, payloadSchema } from "../utils/payload.js";
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
  storage: Storage | undefined;
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
        "--interval <number>",
        "Interval in milliseconds to check for new uploads"
      ).default(5 * 60 * 1000) // 5 minutes
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
        parseInt(options["interval"], 10),
        args.slice()
      );
      await server.serve();
    });
  return command;
};

const restartWorker = (worker: Worker) => {
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
  interval: number;
  args: string[];

  httpServer: HttpServer;
  workers: Worker[] = [];

  constructor(
    port: number,
    publicKey: string,
    controller: Controller,
    numThreads: number,
    interval: number,
    args: string[]
  ) {
    this.port = port;
    this.publicKey = publicKey;
    this.controller = controller;
    this.numThreads = numThreads;
    this.interval = interval;
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

  async servePrimary(): Promise<void> {
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

    await Promise.all(this.workers.map((worker) => once(worker, "online")));
    // debug("all workers are online");
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

      let decoded: JwtData | null = null;
      try {
        decoded = decode(token);
      } catch (error) {
        debug("error decoding token: %O", error);
      }
      if (
        decoded === null ||
        decoded.header === undefined ||
        decoded.header.alg === undefined
      ) {
        return next(new UnauthorizedError("Could not decode token"));
      }

      let verified: boolean = false;
      try {
        verified = await verify(token, this.publicKey, {
          algorithm: decoded.header.alg,
          throwError: true,
        });
      } catch (error) {
        debug("error verifying token: %O", error);
      }
      if (verified !== true) {
        return next(new UnauthorizedError("Invalid token"));
      }

      let payload: Payload;
      try {
        payload = await payloadSchema.validateAsync(decoded.payload);
      } catch (error) {
        return next(new UnauthorizedError("Invalid token payload"));
      }

      const { controller } = io;

      const { t } = payload;
      if (t === "u") {
        const { n, s } = payload;
        const storageProvider = await controller.getStorageProvider(s);
        if (storageProvider === null) {
          return next(
            new UnauthorizedError(
              `Invalid token: storage provider "${s}" not found`
            )
          );
        }
        try {
          const { storage } = storageProvider;
          socket.bucket = await storage.requireBucketName(n);
          socket.storage = storage;
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

    const downloadServer: DownloadServer = new DownloadServer(
      io,
      this.interval
    );
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
    } else {
      throw new Error("serve must be called from primary or worker");
    }
  }
}
