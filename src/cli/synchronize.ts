import { Command, Option } from "commander";

import { getDataSource } from "../data-source.js";

export const makeSynchronizeCommand = (): Command => {
  const command = new Command();
  command
    .name(`synchronize`)
    .addOption(
      new Option("--database-type <type>", "Which type of database to use")
        .choices(["sqlite", "postgres"])
        .default("sqlite")
    )
    .requiredOption(
      "--connection-string <path>",
      "Connection string to the database"
    )
    .showHelpAfterError()
    .action(async () => {
      const options = command.opts();
      const dataSource = await getDataSource(
        options["databaseType"],
        options["connectionString"],
        true
      );
      dataSource.synchronize();
    });
  return command;
};
