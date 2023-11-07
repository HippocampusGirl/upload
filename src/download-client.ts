import { Command } from "commander";
import Debug from "debug";
import Joi from "joi";
import jwt from "jsonwebtoken";
import { Socket } from "socket.io-client";

import { makeClient } from "./socket-client.js";

const debug = Debug("download-client");

export const makeDownloadCommand = () => {
  const command = new Command();
  command
    .name(`download`)
    .showHelpAfterError()
    .requiredOption("--endpoint <value>", "Where the server is located")
    .requiredOption("--token <value>", "Token to authenticate with the server")
    .action(async () => {
      const options = command.opts();

      const endpoint = options.endpoint;
      if (typeof endpoint !== "string") {
        throw new Error(`"endpoint" needs to be a string`);
      }
      Joi.assert(endpoint, Joi.string().uri({ scheme: ["http", "https"] }));

      const token = options.token;
      if (typeof token !== "string") {
        throw new Error(`"token" needs to be a string`);
      }
      const payload = jwt.decode(token);
      if (typeof payload !== "object" || payload === null) {
        throw new Error(`"token" does not have a payload`);
      }
      const { type } = payload;
      if (type !== "upload") {
        throw new Error(`"token" is not an upload token`);
      }

      const socket = makeClient(endpoint, token);
      const client = new DownloadClient(socket);

      await client.listen();

      socket.disconnect();
    });
  return command;
};

class DownloadClient {
  socket: Socket;

  constructor(socket: Socket) {
    this.socket = socket;
  }

  async listen() {
    this.socket.on("download:create", async (url: string) => {
      const { hostname, pathname } = new URL(url);
      const bucket = hostname.split(".")[0];
      if (!bucket.startsWith("upload-")) {
        throw new Error(`Invalid bucket name: ${bucket}`);
      }
    });
  }
}
