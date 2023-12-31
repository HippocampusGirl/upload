import Debug from "debug";
import Joi from "joi";
import { io, ManagerOptions, SocketOptions } from "socket.io-client";

import { getHttpsProxyAgent } from "./proxy.js";
import { _ClientSocket } from "./socket.js";

const debug = Debug("socket-client");

export const endpointSchema = Joi.string().uri({
  scheme: ["http", "https", "ws", "wss"],
});
export const makeClient = (endpoint: string, token: string): _ClientSocket => {
  const options: Partial<ManagerOptions & SocketOptions> = {
    auth: { token },
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
