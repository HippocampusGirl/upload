import "reflect-metadata";

import { Command } from "commander";
import Debug from "debug";
import { isMainThread } from "node:worker_threads";

import { makeCreateTokenCommand } from "./create-token.js";
import { makeDownloadClientCommand } from "./download-client/download-client.js";
import { makeServeCommand } from "./server/serve.js";
import { makeUploadClientCommand } from "./upload-client/upload-client.js";
import { worker } from "./upload-client/worker.js";

if (isMainThread) {
  const command = new Command();
  command
    .option("--debug", "Output extra debug information")
    .addCommand(makeCreateTokenCommand())
    .addCommand(makeServeCommand())
    .addCommand(makeUploadClientCommand())
    .addCommand(makeDownloadClientCommand())
    .hook("preAction", (that) => {
      if (that.opts().debug) {
        Debug.enable("*");
      } else {
        Debug.enable(
          "upload-client,download-client,socket-client,serve,storage"
        );
      }
    });

  command.parse(process.argv);
} else {
  worker();
}
