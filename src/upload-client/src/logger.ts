import { logLevel } from "./options.js";
import winston from "winston";

export const logger = winston.createLogger({
  level: logLevel,
  transports: [new winston.transports.Console()],
});
