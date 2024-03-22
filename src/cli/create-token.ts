import { Command } from "commander";
import jwt from "jsonwebtoken";
import { readFileSync } from "node:fs";

import { Payload, payloadSchema } from "../utils/payload.js";
import { validate } from "../utils/validate.js";

export const makeCreateTokenCommand = (): Command => {
  const command = new Command();
  command
    .name(`create-token`)
    .showHelpAfterError()
    .option("--name <value>", "Name for the token")
    .requiredOption(
      "--type <value>",
      "Whether the token will be valid for uploads or downloads"
    )
    .option("--storage-id <value>", "Which cloud provider to use")
    .requiredOption(
      "--private-key-file <path>",
      "Path to the private key file generated with `openssl ecparam -name prime256v1 -genkey`"
    )
    .action(() => {
      const options = command.opts();

      const type = options["type"];
      const mapping: { [key: string]: "u" | "d" } = {
        upload: "u",
        download: "d",
      };
      const t = mapping[type];

      let payload: Payload;
      if (t === "u") {
        const n = options["name"];
        const s = options["storageId"];
        payload = { n, t, s };
      } else if (t === "d") {
        payload = { t };
      } else {
        throw new Error("Type must be 'upload' or 'download'");
      }

      const privateKeyFile = options["privateKeyFile"];
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

const createToken = (payload: string | object, privateKey: string): string => {
  payload = validate(payloadSchema, payload);
  const token = jwt.sign(payload, privateKey, { algorithm: "ES256" });
  return token;
};
