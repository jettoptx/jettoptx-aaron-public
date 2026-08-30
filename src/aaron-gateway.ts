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
  // Payable JOE / x402 surface (USDC → jtxfaucet.sol).
  // GET /x402 and GET /x402/prima_title are first-match edge handlers in index.ts.
  "/x402",
  "/orphan",
  "/.well-known/agent-card.json",
  // Do not add /mcp/jettchat — JOE-gated in index.ts, then proxyToAaron.
  // Do not add /joe/hedgehog — JOE-gated in index.ts, then proxyToAaron.
  // Do not add /joe/mcp — JOE-gated in index.ts, then proxyToAaron.
  // Do not add /joe/ore — JOE-gated in index.ts, then proxyToAaron. Helius stays on origin.
  // Do not add /specs — public JOB-SPEC is first-match edge JSON in index.ts (never 402).
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
 * Not AARON_PATHS. Not /mcp/* (hedgehog would swallow).
 */
export function isJoeHedgehogPath(pathname: string): boolean {
  return (
    pathname === "/joe/hedgehog" ||
    pathname === "/joe/hedgehog/" ||
    pathname === "/joe/hedgehog/sse" ||
    pathname === "/joe/hedgehog/sse/"
  );
}

/**
 * Computer AddMcpServer door (header auth only — no token in the URL).
 * Exact /joe/mcp and /joe/mcp/sse (optional trailing slash). GET/POST.
 * First-match in index.ts BEFORE isHedgehogPath and isAaronPath.
 * Not AARON_PATHS. Not Hedgehog /mcp. Phone sheet cannot auth (no header).
 */
export function isJoeMcpPath(pathname: string): boolean {
  return (
    pathname === "/joe/mcp" ||
    pathname === "/joe/mcp/" ||
    pathname === "/joe/mcp/sse" ||
    pathname === "/joe/mcp/sse/"
  );
}

/**
 * JOE-token porch for ORE / AgenC (program oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv).
 * Explicit list only — do not prefix-match /joe/ore/* (would swallow /joe/ore/extra).
 * Live origin doors (joe-aaron-router): POST/GET /joe/ore/rpc, GET /joe/ore/subscribe.
 * Also /joe/ore and /joe/ore/sse (optional trailing slashes).
 * First-match in index.ts BEFORE isHedgehogPath and isAaronPath.
 * Not AARON_PATHS. Worker has no Helius — paid gRPC subscribe stays on AARON_ORIGIN.
 * Unauth GET/POST must 401 (never 404, never a public RPC proxy).
 */
const JOE_ORE_PATHS = [
  "/joe/ore",
  "/joe/ore/",
  "/joe/ore/rpc",
  "/joe/ore/rpc/",
  "/joe/ore/subscribe",
  "/joe/ore/subscribe/",
  "/joe/ore/sse",
  "/joe/ore/sse/",
] as const;

export function isJoeOrePath(pathname: string): boolean {
  return JOE_ORE_PATHS.some((p) => p === pathname);
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
