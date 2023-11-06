import Debug from "debug";
import { RequestError, got } from "got";

const debug = Debug("got");

export const client = got.extend({
  hooks: {
    beforeRequest: [
      (options) => {
        debug(`${options.method} ${options.url}`);
      },
    ],
    afterResponse: [
      (response, retryWithMergedOptions) => {
        debug(`${response.statusCode} ${response.statusMessage}`);
        return response;
      },
    ],
    beforeRetry: [
      (error: RequestError, count) => {
        debug(`${error?.response?.statusCode} retry number ${count}`);
      },
    ],
  },
});
