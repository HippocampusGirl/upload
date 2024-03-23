/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { verify } from "@tsndr/cloudflare-worker-jwt";

export interface Env {
  PUBLIC_KEY: string;
}

const pattern = new URLPattern({
  protocol: "http{s}?",
  pathname: "/:hostname(f\\d{3}.backblazeb2.com)/file/:bucket/:path",
  hash: "",
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") {
      return methodNotAllowed(request);
    }

    let match: URLPatternURLPatternResult | null = null;
    try {
      match = pattern.exec(request.url);
    } catch {
      // Invalid url
    }
    if (match === null) {
      return notFound();
    }

    const hostname = match.pathname.groups["hostname"]!;
    const bucket = match.pathname.groups["bucket"]!;
    const path = match.pathname.groups["path"]!;

    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (token === null) {
      return badRequest();
    }

    const publicKey = env.PUBLIC_KEY;
    let verified: boolean = false;
    try {
      verified = await verify(token, publicKey, "ES256");
    } catch (error) {
      // Invalid token
    }
    if (verified !== true) {
      return unauthorized();
    }

    return new Response(
      "Hello, world! " + JSON.stringify({ hostname, bucket, path })
    );
    // fetch("http://example.com");
  },
} satisfies ExportedHandler<Env, unknown, unknown>;
