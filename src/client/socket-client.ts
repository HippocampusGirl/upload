import Debug from "debug";
import Joi from "joi";
import { io, ManagerOptions, SocketOptions } from "socket.io-client";
import msgpackParser from "socket.io-msgpack-parser";

import { _ClientSocket } from "../socket.js";
import { version } from "../utils/metadata.js";
import { getHttpsProxyAgent } from "../utils/proxy.js";

const debug = Debug("client");

export const endpointSchema = Joi.string().uri({
  scheme: ["http", "https", "ws", "wss"],
});
export const makeClient = (endpoint: string, token: string): _ClientSocket => {
  const options: Partial<ManagerOptions & SocketOptions> = {
    auth: { token },
    ackTimeout: 5000, // 5 seconds
    retries: 100,
    parser: msgpackParser,
    extraHeaders: {
      "upload-client-version": version,
    },
  };

  const agent = getHttpsProxyAgent();
  if (agent !== undefined) {
    options.agent = agent as unknown as string;
  }

  const socket = io(endpoint, options);

  socket.on("connect_error", (error) => {
    debug("failed to connect to server: %o", error.message);
  });

  return socket;
};
