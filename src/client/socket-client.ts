import Debug from "debug";
import { Fetch } from "engine.io-client";
import Joi from "joi";
import { io, ManagerOptions, SocketOptions } from "socket.io-client";
import msgpackParser from "socket.io-msgpack-parser";

import { _ClientSocket } from "../socket.js";
import { version } from "../utils/metadata.js";
const debug = Debug("client");

export const endpointSchema = Joi.string().uri({
  scheme: ["http", "https", "ws", "wss"],
});

export const clientFactory = (
  endpoint: string,
  token: string
): _ClientSocket => {
  const options: Partial<ManagerOptions & SocketOptions> = {
    auth: { token },
    extraHeaders: {
      "upload-client-version": version,
    },

    ackTimeout: 5 * 1000, // 5 seconds
    retries: Infinity,

    parser: msgpackParser,

    transports: [Fetch],
  };

  const socket = io(endpoint, options);

  socket.on("connect_error", (error) => {
    debug("failed to connect to server: %O", error);
  });

  return socket;
};
