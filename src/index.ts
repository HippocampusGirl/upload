import { Command } from "commander";
import Debug from "debug";
import { isMainThread } from "node:worker_threads";

import { makeCreateTokenCommand } from "./create-token.js";
import { makeDownloadCommand } from "./download-client.js";
import { makeServeCommand } from "./serve.js";
import { makeUploadCommand } from "./upload-client.js";
import { worker } from "./worker.js";

if (isMainThread) {
  const command = new Command();
  command
    .option("--debug", "Output extra debug information")
    .addCommand(makeCreateTokenCommand())
    .addCommand(makeServeCommand())
    .addCommand(makeUploadCommand())
    .addCommand(makeDownloadCommand())
    .hook("preAction", (that, actionCommand) => {
      if (that.opts().debug) {
        Debug.enable("*");
      } else {
        Debug.enable("upload-client,download-client,socket-client,serve");
      }
    });

  command.parse(process.argv);
} else {
  worker();
}
