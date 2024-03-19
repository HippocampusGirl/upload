import Debug from "./utils/debug.js";
import Joi from "joi";
import { io, ManagerOptions, SocketOptions } from "socket.io-client";

import { _ClientSocket } from "./socket.js";
import { getHttpsProxyAgent } from "./utils/proxy.js";

const debug = Debug("socket-client");

export const endpointSchema = Joi.string().uri({
  scheme: ["http", "https", "ws", "wss"],
});
export const makeClient = (endpoint: string, token: string): _ClientSocket => {
  const options: Partial<ManagerOptions & SocketOptions> = {
    auth: { token },
    ackTimeout: 5000, // 5 seconds
    retries: 100
  };

  const agent = getHttpsProxyAgent();
  if (agent !== undefined) {
    options.agent = agent as any;
  }

  const socket = io(endpoint, options);

  socket.on("connect_error", (error) => {
    debug(`Failed to connect to server: ${error.message}`);
  });

  return socket;
};
