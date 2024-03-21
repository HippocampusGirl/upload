#!/usr/bin/env node

import "reflect-metadata";

import { Command } from "commander";
import Debug from "debug";
import { isMainThread } from "node:worker_threads";

import { makeAddStorageProviderCommand } from "./add-storage-provider.js";
import { makeDownloadClientCommand } from "./client/download-client.js";
import { makeUploadClientCommand } from "./client/upload-client.js";
import { worker } from "./client/worker.js";
import { makeCreateTokenCommand } from "./create-token.js";
import { makeServeCommand } from "./server/serve.js";
import { makeSynchronizeCommand } from "./synchronize.js";

if (isMainThread) {
  const command = new Command();
  command
    .option("--debug", "Output extra debug information")
    .addCommand(makeCreateTokenCommand())
    .addCommand(makeServeCommand())
    .addCommand(makeUploadClientCommand())
    .addCommand(makeDownloadClientCommand())
    .addCommand(makeSynchronizeCommand())
    .addCommand(makeAddStorageProviderCommand())
    .hook("preAction", (that) => {
      const options = that.opts();
      if (options["debug"]) {
        Debug.enable("*");
      } else {
        Debug.enable(
          "upload-client,download-client,socket-client,serve,storage,data-source"
        );
      }
    });

  command.parse(process.argv);
} else {
  worker();
}
