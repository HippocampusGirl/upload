import Debug from "debug";
import { got, OptionsInit, RequestError } from "got";
import { Agent } from "node:https";

import { getHttpsProxyAgent } from "./proxy.js";

const debug = Debug("got");

const agent: Agent | undefined = getHttpsProxyAgent();
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

interface Options extends OptionsInit {
  isStream?: true;
}

export const retryCount = 100;
export const timeout = 10 * 1000; // 10 seconds
export const requestTimeout = 3600 * 1000; // 1 hour
export const requestOptions: Options = {
  retry: {
    limit: retryCount,
  },
  timeout: {
    lookup: timeout,
    connect: timeout,
    secureConnect: timeout,
    socket: timeout,
    response: timeout,
    send: 60 * 1000, // 1 minute
    request: requestTimeout,
  },
};
