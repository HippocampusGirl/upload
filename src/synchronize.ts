import { Command, Option } from "commander";
import Debug from "debug";

import { getDataSource } from "./data-source.js";

const debug = Debug("data-source");

export const makeSynchronizeCommand = (): Command => {
  const command = new Command();
  command
    .name(`synchronize`)
    .addOption(
      new Option("--database-type <type>", "Which type of database to use")
        .choices(["sqlite", "postgres"])
        .default("sqlite")
    )
    .addOption(
      new Option(
        "--database-path <path>",
        "Path of the database to connect to"
      ).default("server.sqlite")
    )
    .showHelpAfterError()
    .action(async () => {
      const options = command.opts();
      const dataSource = await getDataSource(
        options.databaseType,
        options.databasePath,
        true
      );
      dataSource.synchronize();
    });
  return command;
};
