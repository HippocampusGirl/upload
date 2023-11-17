import { Server, Socket as ServerSocket } from "socket.io";
import { Socket as ClientSocket } from "socket.io-client";

import { ChecksumJob, DownloadJob } from "./download-schema.ts";
import { UploadCreateError } from "./errors.ts";
import { UploadJob, UploadRequest } from "./upload-parts.ts";

export interface ClientToServerEvents {
  "download:complete": (downloadJob: DownloadJob, callback: () => void) => void;
  "download:verified": (downloadJob: DownloadJob, callback: () => void) => void;
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

export interface ServerToClientEvents {
  "download:create": (downloadJobs: DownloadJob[]) => void;
  "download:checksum": (checksumJob: ChecksumJob) => void;
}

export interface ServerSideEvents {}
export interface SocketData {}

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
