import Debug from "debug";
import { got } from "got";
import { Agent } from "node:https";

import { getHttpsProxyAgent } from "./proxy.js";

import type { Agents, OptionsInit, RequestError } from "got";
const debug = Debug("http-client");

const agent: Agents = {};

const httpsProxyAgent: Agent | null = getHttpsProxyAgent();
if (httpsProxyAgent) {
  agent.https = httpsProxyAgent;
}

export const client = got.extend({
  agent,
  hooks: {
    beforeRequest: [
      (options) => {
        debug(`${options.method} ${options.url}`);
      },
    ],
    afterResponse: [
      (response) => {
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

const retryCount = 100;
const timeout = 10 * 1000; // 10 seconds
const requestTimeout = 10 * 60 * 1000; // 10 minutes
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
    send: requestTimeout,
    request: requestTimeout,
  },
};
