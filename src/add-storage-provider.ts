import { Command, Option } from "commander";

import { getDataSource } from "./data-source.js";
import { StorageProvider } from "./entity.js";

export const makeAddStorageProviderCommand = (): Command => {
  const command = new Command();
  command
    .name(`add-storage-provider`)
    .addOption(
      new Option("--database-type <type>", "Which type of database to use")
        .choices(["sqlite", "postgres"])
        .default("sqlite")
    )
    .requiredOption(
      "--connection-string <path>",
      "Connection string to the database"
    )
    .requiredOption(
      "--id <string>",
      "A unique identifier"
    )
    .requiredOption(
      "--region <string>",
      "The region that will be used to initialize the S3Client"
    )
    .requiredOption(
      "--accessKeyId <string>",
      "The accessKeyId that will be used to initialize the S3Client"
    )
    .requiredOption(
      "--secretAccessKey <string>",
      "The secretAccessKey that will be used to initialize the S3Client"
    )
    .option(
      "--bucket-location-constraint <string>",
      "The location constraint to use when creating new buckets"
    )
    .showHelpAfterError()
    .action(async () => {
      const options = command.opts();
      const dataSource = await getDataSource(
        options["databaseType"],
        options["connectionString"],
        true
      );
      const storageProvider = new StorageProvider({
        id: options["id"],
        region: options["region"],
        accessKeyId: options["accessKeyId"],
        secretAccessKey: options["secretAccessKey"],
        endpoint: "https://s3.amazonaws.com",
        bucketLocationConstraint: options["bucketLocationConstraint"]
      });
      await dataSource.manager.save(storageProvider);
    });
  return command;
};
