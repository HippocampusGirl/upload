import { CustomError } from "./error.js";

export const enum Http {
  RequestTimeout = 408,
  TooManyRequests = 429,
  InternalServerError = 500,
  BadGateway = 502,
  ServiceUnavailable = 503,
  GatewayTimeout = 504,
  WebServerIsDown = 521,
  ConnectionTimedOut = 522,
  ATimeoutOccurred = 524,
}
export const retryCodes = [
  Http.RequestTimeout,
  Http.TooManyRequests,
  Http.InternalServerError,
  Http.BadGateway,
  Http.ServiceUnavailable,
  Http.GatewayTimeout,
  Http.WebServerIsDown,
  Http.ConnectionTimedOut,
  Http.ATimeoutOccurred,
];

export class InvalidResponseError extends CustomError {}
