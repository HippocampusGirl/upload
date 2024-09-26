import Debug from "debug";
import { Fetch, WebSocket as WS } from "engine.io-client";
import type { Packet, RawData } from "engine.io-parser";
import Joi from "joi";
import { io, ManagerOptions, SocketOptions } from "socket.io-client";
import msgpackParser from "socket.io-msgpack-parser";
import { WebSocket } from "undici";
import { _ClientSocket } from "../socket.js";
import { version } from "../utils/metadata.js";
const debug = Debug("client");

export const endpointSchema = Joi.string().uri({
  scheme: ["http", "https", "ws", "wss"],
});

export class _WebSocket extends WS {
  override createSocket(
    uri: string,
    protocols: string | string[] | undefined,
    _: Record<string, any>
  ) {
    return protocols ? new WebSocket(uri, protocols) : new WebSocket(uri);
  }

  override doWrite(_packet: Packet, data: RawData) {
    this.ws.send(data);
  }

  protected override async onData(data: RawData): Promise<void> {
    if (data instanceof Blob) {
      // engine.io-client expects an array buffer
      data = await data.arrayBuffer();
    }
    super.onData(data);
  }
}

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

    transports: [_WebSocket, Fetch],
  };

  const socket = io(endpoint, options);

  socket.on("connect_error", (error) => {
    debug("failed to connect to server: %O", error);
  });

  return socket;
};
