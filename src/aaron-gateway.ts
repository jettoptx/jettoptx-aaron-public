/**
 * AARON edge proxy — gaze verify, session, mint path (not HEDGEHOG Grok).
 */

import type { GatewayEnv } from "./lib/cors";
import { getCorsHeaders } from "./lib/cors";

const AARON_PATHS = [
  "/session",
  "/verify",
  "/gaze",
  "/mint",
  "/handshake",
  // Payable JOE / x402 surface (USDC → jtxfaucet.sol)
  "/x402",
  "/orphan",
  "/.well-known/agent-card.json",
  // Do not add /mcp/jettchat — JOE-gated in index.ts, then proxyToAaron.
  // Do not add /joe/hedgehog — JOE-gated in index.ts, then proxyToAaron.
];

export function isAaronPath(pathname: string): boolean {
  return AARON_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

/**
 * Joe/hedgehog MCP transport on the public Worker.
 * Exact /joe/hedgehog (optional trailing slash) and /joe/hedgehog/sse.
 * Must be first-match in index.ts BEFORE isHedgehogPath and isAaronPath.
 * Not AARON_PATHS. Not /mcp/* (hedgehog would swallow). Not /joe/mcp.
 */
export function isJoeHedgehogPath(pathname: string): boolean {
  return (
    pathname === "/joe/hedgehog" ||
    pathname === "/joe/hedgehog/" ||
    pathname === "/joe/hedgehog/sse" ||
    pathname === "/joe/hedgehog/sse/"
  );
}

export async function proxyToAaron(
  request: Request,
  env: GatewayEnv,
  requestId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const originUrl = new URL(env.AARON_ORIGIN);
  const target = new URL(url.pathname + url.search, originUrl);

  const headers = new Headers(request.headers);
  headers.set("X-Request-ID", requestId);
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
  headers.delete("host");

  const res = await fetch(target.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
  });

  const responseHeaders = new Headers(res.headers);
  const cors = getCorsHeaders(request, env);
  cors.forEach((v, k) => responseHeaders.set(k, v));
  responseHeaders.set("X-Request-ID", requestId);
  responseHeaders.set("X-AARON-Gateway", "jettoptx-aaron-hedgehog");

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders,
  });
}
