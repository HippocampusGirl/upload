import Debug from "debug";
import { io } from "socket.io-client";

import { _ClientSocket } from "./socket.js";

const debug = Debug("socket-client");

export const makeClient = (endpoint: string, token: string): _ClientSocket => {
  const socket = io(endpoint, {
    auth: { token },
  });

  socket.on("connect_error", (error) => {
    debug(`Failed to connect to server: ${error.message}`);
  });

  return socket;
};
