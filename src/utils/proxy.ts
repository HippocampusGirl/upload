import { HttpsProxyAgent } from "https-proxy-agent";
import Joi from "joi";
import { Agent } from "node:https";

const httpProxy =
  process.env.http_proxy ||
  process.env.HTTP_PROXY ||
  process.env.https_proxy ||
  process.env.HTTPS_PROXY ||
  process.env.all_proxy ||
  process.env.ALL_PROXY;
export const httpProxySchema = Joi.string().uri({
  scheme: ["http", "https"],
});
export const getHttpsProxyAgent = (): Agent | undefined => {
  if (httpProxy) {
    Joi.assert(httpProxy, httpProxySchema);
    return new HttpsProxyAgent(httpProxy);
  }
  return undefined;
};
