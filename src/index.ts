import { Command } from "commander";
import Debug from "debug";
import { isMainThread } from "node:worker_threads";

import { makeCreateTokenCommand } from "./create-token.ts";
import { makeDownloadCommand } from "./download-client.ts";
import { makeServeCommand } from "./serve.ts";
import { makeUploadCommand } from "./upload-client.ts";
import { worker } from "./worker.ts";

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
        Debug.enable(
          "upload-client,download-client,socket-client,serve,storage"
        );
      }
    });

  command.parse(process.argv);
} else {
  worker();
}
