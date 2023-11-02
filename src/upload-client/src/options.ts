import { parse } from "bytes";
import { Command } from "commander";
import Joi from "joi";

const command = new Command();
command
  .name(`upload-client`)
  .showHelpAfterError()
  .requiredOption("--endpoint <value>", "Where the server is located")
  .requiredOption("--token <value>", "Token to authenticate with the server")
  .requiredOption("--path <value...>", "Path to upload")
  .option(
    "--min-part-size <size>",
    "Minimum size of file parts for concurrent upload",
    "5MB"
  )
  .option("--num-threads <count>", "Number of concurrent upload threads", "20")
  .option(
    "--log-level <level>",
    "Show log messages of this level and higher severity",
    "info"
  )
  .parse(process.argv);
const options = command.opts();

export const endpoint = options.endpoint;
if (typeof endpoint !== "string") {
  throw new Error(`"endpoint" needs to be a string`);
}
Joi.assert(endpoint, Joi.string().uri({ scheme: ["http", "https"] }));

export const token = options.token;
if (typeof token !== "string") {
  throw new Error(`"token" needs to be a string`);
}

export const paths = options.path;
if (!Array.isArray(paths)) {
  throw new Error(`"paths" needs to be an array`);
}

export const minPartSize = parse(options.minPartSize);

export const numThreads = parseInt(options.numThreads, 10);
if (typeof numThreads !== "number") {
  throw new Error(`"numThreads" needs to be a number`);
}

export const logLevel = options.logLevel;
if (typeof logLevel !== "string") {
  throw new Error(`"logLevel" needs to be a string`);
}
