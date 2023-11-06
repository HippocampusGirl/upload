import { io, Socket } from "socket.io-client";

export const makeClient = (endpoint: string, token: string): Socket => {
  const socket = io(endpoint, {
    auth: { token },
  });

  socket.on("connect_error", (error) => {
    throw new Error(`Failed to connect to server: ${error.message}`);
  });

  return socket;
};
