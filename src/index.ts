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

export const command = new Command();
command
  .option("--debug", "Output extra debug information")
  .addCommand(makeCreateTokenCommand())
  .addCommand(makeAddStorageProviderCommand())
  .addCommand(makeServeCommand())
  .addCommand(makeUploadClientCommand())
  .addCommand(makeDownloadClientCommand())
  .addCommand(makeSynchronizeCommand())
  .hook("preAction", (that) => {
    const options = that.opts();
    if (process.env["DEBUG"]) {
      return;
    }
    if (options["debug"]) {
      Debug.enable("*");
    } else {
      Debug.enable("client,server,storage,data-source");
    }
  });

export const isMainModule = import.meta.filename === process?.argv[1];
if (isMainModule) {
  if (isMainThread) {
    command.parse(process.argv);
  } else {
    worker();
  }
}
