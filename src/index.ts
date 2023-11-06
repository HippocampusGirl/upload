import { Command } from "commander";
import Debug from "debug";

import { makeCreateTokenCommand } from "./create-token.js";
import { makeServeCommand } from "./serve.js";
import { makeUploadCommand } from "./upload-client.js";

const command = new Command();
command
  .option("--debug", "Output extra debug information")
  .addCommand(makeCreateTokenCommand())
  .addCommand(makeServeCommand())
  .addCommand(makeUploadCommand())
  .hook("preAction", (that, actionCommand) => {
    if (that.opts().debug) {
      Debug.enable("*");
    }
  });

command.parse(process.argv);
