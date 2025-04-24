/**
 * Welcome to Cloudflare Workers! This is your first worker.
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { AwsClient } from "aws4fetch";

import { decode, JwtData, verify } from "@tsndr/cloudflare-worker-jwt";

import { getSuffix } from "./storage/bucket-name.js";

import type { DownloadPayload } from "./utils/payload.js";

declare const self: ServiceWorkerGlobalScope;
const { URLPattern } = self;

export interface Env {
  jwtPublicKey: string;

  backblazeB2USEastApplicationKeyId: string;
  backblazeB2USEastApplicationKey: string;
  backblazeB2USEastEndpoint: string;

  backblazeB2EUCentralApplicationKey: string;
  backblazeB2EUCentralApplicationKeyId: string;
  backblazeB2EUCentralEndpoint: string;

  backblazeB2USWestApplicationKeyId: string;
  backblazeB2USWestApplicationKey: string;
  backblazeB2USWestEndpoint: string;
}

const pattern = new URLPattern({
  protocol: "http{s}?",
  pathname: "/file/:bucket/:key+",
});

const methodNotAllowed = (request: Request): Response => {
  return new Response(`Method ${request.method} not allowed`, {
    status: 405,
    headers: {
      Allow: "GET",
    },
  });
};
const badRequest = (): Response => {
  return new Response(null, { status: 400 });
};
const unauthorized = (): Response => {
  return new Response(null, { status: 401 });
};
const notFound = (): Response => {
  return new Response(null, { status: 404 });
};

const authenticate = async (
  request: Request,
  env: Env
): Promise<Response | undefined> => {
  const token = request.headers.get("Authorization");
  if (token === null) {
    return badRequest();
  }

  let decoded: JwtData | null = null;
  try {
    decoded = decode(token);
  } catch (error) {
    console.log("error decoding token", error);
  }
  if (
    decoded === null ||
    decoded.header === undefined ||
    decoded.header.alg === undefined
  ) {
    console.log("invalid token header");
    return unauthorized();
  }

  let verified = undefined;
  try {
    verified = await verify(token, env.jwtPublicKey, {
      algorithm: decoded.header.alg,
      throwError: true,
    });
  } catch (error) {
    console.log("error verifying token", error);
  }
  if (!verified) {
    console.log("invalid token");
    return unauthorized();
  }

  const payload = decoded.payload as DownloadPayload | undefined;
  if (payload === undefined || payload.t !== "d") {
    console.log("invalid token payload");
    return unauthorized();
  }

  return;
};

class StorageProvider {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;

  constructor({
    endpoint,
    accessKeyId,
    secretAccessKey,
  }: Partial<StorageProvider>) {
    this.endpoint = endpoint!;
    this.accessKeyId = accessKeyId!;
    this.secretAccessKey = secretAccessKey!;
  }

  get region(): string {
    const { hostname } = new URL(this.endpoint);
    const match = hostname.match(/^s3\.(.+)\.backblazeb2\.com$/);
    if (match === null) {
      throw new Error("Invalid endpoint");
    }
    const region = match[1];
    if (region === undefined) {
      throw new Error("Endpoint does not contain region");
    }
    return region;
  }
  get client(): AwsClient {
    return new AwsClient({
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      service: "s3",
      region: this.region,
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await authenticate(request, env);
    if (response !== undefined) {
      return response;
    }

    if (request.method !== "GET") {
      return methodNotAllowed(request);
    }

    let match: URLPatternResult | null = null;
    try {
      match = pattern.exec(request.url);
    } catch {
      // Invalid url
    }
    if (match === null) {
      return notFound();
    }

    const bucket = match.pathname.groups["bucket"]!;
    const key = match.pathname.groups["key"]!;

    const storageProviders: StorageProvider[] = [
      new StorageProvider({
        endpoint: env.backblazeB2USEastEndpoint,
        accessKeyId: env.backblazeB2USEastApplicationKeyId,
        secretAccessKey: env.backblazeB2USEastApplicationKey,
      }),
      new StorageProvider({
        endpoint: env.backblazeB2EUCentralEndpoint,
        accessKeyId: env.backblazeB2EUCentralApplicationKeyId,
        secretAccessKey: env.backblazeB2EUCentralApplicationKey,
      }),
      new StorageProvider({
        endpoint: env.backblazeB2USWestEndpoint,
        accessKeyId: env.backblazeB2USWestApplicationKeyId,
        secretAccessKey: env.backblazeB2USWestApplicationKey,
      }),
    ];
    const matches = await Promise.all(
      storageProviders.map(async (provider): Promise<boolean> => {
        const suffix = await getSuffix(provider.accessKeyId);
        return bucket.endsWith(suffix);
      })
    );
    const storageProviderIndex = matches.findIndex((match) => match === true);
    const storageProvider = storageProviders[storageProviderIndex];
    if (storageProvider === undefined) {
      return notFound();
    }

    const headers = new Headers();
    const allowed = new Set([
      "content-type",
      "date",
      "host",
      "if-match",
      "if-modified-since",
      "if-none-match",
      "if-unmodified-since",
      "range",
    ]);
    for (const [key, value] of request.headers.entries()) {
      if (!allowed.has(key)) {
        continue;
      }
      headers.set(key, value);
    }

    const path = [bucket, key].join("/");
    const url = new URL(path, storageProvider.endpoint);
    const signedRequest = await storageProvider.client.sign(url.toString(), {
      headers,
    });

    return fetch(signedRequest);
  },
} satisfies ExportedHandler<Env>;
