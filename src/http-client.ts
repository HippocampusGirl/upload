import Debug from "debug";
import { got, RequestError } from "got";

import { getHttpsProxyAgent } from "./proxy.js";

const debug = Debug("got");

const agent = getHttpsProxyAgent();
export const client = got.extend({
  agent: {
    https: agent,
  },
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
