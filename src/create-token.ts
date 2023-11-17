import { Command } from "commander";
import jwt from "jsonwebtoken";
import { readFileSync } from "node:fs";

import { Payload, payloadSchema } from "./payload.ts";
import { validate } from "./validate.ts";

export const makeCreateTokenCommand = (): Command => {
  const command = new Command();
  command
    .name(`create-token`)
    .showHelpAfterError()
    .requiredOption("--name <value>", "Where the server is located")
    .requiredOption("--type <value>", "Token to authenticate with the server")
    .option("--loc <value>", "Location hint for the cloud provider")
    .requiredOption(
      "--private-key-file <path>",
      "Path to the private key file generated with `openssl ecparam -name prime256v1 -genkey`"
    )
    .action(() => {
      const options = command.opts();

      const name = options.name;
      const type = options.type;
      const loc = options.loc;
      const payload: Payload = { name, type, loc };

      const privateKeyFile = options.privateKeyFile;
      if (typeof privateKeyFile !== "string") {
        throw new Error("privateKeyFile must be a string");
      }
      const privateKey = readFileSync(privateKeyFile, "utf8");

      const token = createToken(payload, privateKey);
      process.stdout.write(token);
      process.stdout.write("\n");
    });
  return command;
};

export const createToken = (payload: any, privateKey: string): string => {
  payload = validate(payloadSchema, payload);
  const token = jwt.sign(payload, privateKey, { algorithm: "ES256" });
  return token;
};
