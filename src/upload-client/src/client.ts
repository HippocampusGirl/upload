import { RequestError, got } from "got";
import { logger } from "./logger.js";

export const client = got.extend({
  hooks: {
    beforeRequest: [
      (options) => {
        logger.log({
          level: "debug",
          message: `got ${options.method} ${options.url}`,
        });
      },
    ],
    afterResponse: [
      (response, retryWithMergedOptions) => {
        logger.log({
          level: "debug",
          message: `got ${response.statusCode} ${response.statusMessage}`,
        });
        return response;
      },
    ],
    beforeRetry: [
      (error: RequestError, count) => {
        logger.log({
          level: "info",
          message: `got ${error?.response?.statusCode} retry number ${count}`,
        });
      },
    ],
  },
});
