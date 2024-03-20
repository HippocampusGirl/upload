import { Server, Socket as ServerSocket } from "socket.io";
import { Socket as ClientSocket } from "socket.io-client";

import { UploadJob, UploadRequest } from "./client/upload-parts.js";
import { ChecksumJob, DownloadFile, DownloadJob } from "./download-schema.js";
import { UploadCreateError } from "./utils/errors.js";

interface ClientToServerEvents {
  "download:complete": (downloadJob: DownloadJob, callback: () => void) => void;
  "download:verified": (file: DownloadFile, callback: () => void) => void;
  "upload:create": (
    uploadRequests: UploadRequest[],
    callback: (u: (UploadJob | UploadCreateError)[]) => void
  ) => void;
  "upload:complete": (
    uploadJob: UploadJob,
    callback: (u: UploadCreateError | undefined) => void
  ) => void;
  "upload:checksum": (
    path: string,
    checksumSHA256: string,
    callback: (u: UploadCreateError | undefined) => void
  ) => void;
}

interface ServerToClientEvents {
  "download:create": (downloadJobs: DownloadJob[]) => void;
  "download:checksum": (checksumJob: ChecksumJob) => void;
}

interface ServerSideEvents { }
interface SocketData { }

export type _Server = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  ServerSideEvents,
  SocketData
>;
export type _ServerSocket = ServerSocket<
  ClientToServerEvents,
  ServerToClientEvents,
  ServerSideEvents,
  SocketData
>;

export type _ClientSocket = ClientSocket<
  ServerToClientEvents,
  ClientToServerEvents
>;
