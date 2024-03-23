import { Command } from "commander";
import Joi from "joi";
import { readFile } from "node:fs/promises";

import { sign } from "@tsndr/cloudflare-worker-jwt";

import { Payload, payloadSchema } from "../utils/payload.js";

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
    .action(async () => {
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
      const privateKey = await readFile(privateKeyFile, "utf8");

      const token = createToken(payload, privateKey);
      process.stdout.write(await token);
      process.stdout.write("\n");
    });
  return command;
};

const createToken = (value: object, privateKey: string): Promise<string> => {
  const payload = Joi.attempt(value, payloadSchema);
  const token = sign<Payload>(payload, privateKey, {
    algorithm: "ES256",
  });
  return token;
};
