#!/usr/bin/env node

import "reflect-metadata";

import { Command } from "commander";
import Debug from "debug";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread } from "node:worker_threads";

import { makeAddStorageProviderCommand } from "./cli/add-storage-provider.js";
import { makeCreateTokenCommand } from "./cli/create-token.js";
import { makeSynchronizeCommand } from "./cli/synchronize.js";
import { makeDownloadClientCommand } from "./client/download-client.js";
import { makeUploadClientCommand } from "./client/upload-client.js";
import { worker } from "./client/worker.js";
import { makeServeCommand } from "./server/serve.js";

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

const fileName = process.argv[1];
export const isMainModule =
  fileName !== undefined &&
  fileURLToPath(import.meta.url) === resolve(fileName);
if (isMainModule) {
  if (isMainThread) {
    command.parse(process.argv);
  } else {
    worker();
  }
}
