import { Command } from "commander";
import jwt from "jsonwebtoken";
import { payloadSchema, validate } from "./schema.js";
import { readFileSync } from "node:fs";

export const makeCreateTokenCommand = (): Command => {
  const command = new Command();
  command
    .name(`create-token`)
    .showHelpAfterError()
    .requiredOption("--name <value>", "Where the server is located")
    .requiredOption("--type <value>", "Token to authenticate with the server")
    .requiredOption(
      "--private-key-file <path>",
      "Path to the private key file generated with `openssl ecparam -name prime256v1 -genkey`"
    )
    .action(() => {
      const options = command.opts();

      const name = options.name;
      const type = options.type;
      const payload = { name, type };

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
