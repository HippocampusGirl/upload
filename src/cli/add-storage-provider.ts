import { Command, Option } from "commander";

import { getDataSource } from "../entity/data-source.js";
import { StorageProvider } from "../entity/storage-provider.js";

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
    .requiredOption("--id <string>", "A unique identifier")
    .requiredOption("--endpoint <string>", "The endpoint to connect to")
    .requiredOption(
      "--region <string>",
      "The region where the program will upload to"
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
    .option("--download-url-template <string>", "Use this download url instead")
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
        endpoint: options["endpoint"],
        bucketLocationConstraint: options["bucketLocationConstraint"],
        downloadUrlTemplate: options["downloadUrlTemplate"],
      });
      await dataSource.manager.save(storageProvider);
    });
  return command;
};
