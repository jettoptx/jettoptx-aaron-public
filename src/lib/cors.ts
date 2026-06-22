/**
 * Shared CORS + request ID utilities for jettoptx-aaron-hedgehog edge gateway.
 */

export interface GatewayEnv {
  AARON_ORIGIN: string;
  HEDGEHOG_ORIGIN: string;
  ENV: string;
  CORS_PROD_DOMAINS?: string;
  CORS_DEV_DOMAINS?: string;
  /** SpacetimeDB HTTP SQL endpoint — e.g. https://stdb.jettoptics.ai/v1/database/jettchat */
  SPACETIME_HTTP_URL?: string;
  /** Admin MCP API key (set as Worker secret in dashboard) */
  MCP_API_KEY?: string;
  /** Helius mainnet RPC for WEALTH8 JTX / NFT checks */
  HELIUS_MAINNET_RPC?: string;
}

const ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";

export function getCorsHeaders(request: Request, env: GatewayEnv): Headers {
  const origin = request.headers.get("Origin") || "";
  const allowed = [
    ...(env.CORS_PROD_DOMAINS || "").split(",").map((s) => s.trim()).filter(Boolean),
    ...(env.CORS_DEV_DOMAINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  ];

  const allowOrigin = allowed.some((d) => {
    if (d.includes("*")) {
      const re = new RegExp("^" + d.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
      return re.test(origin);
    }
    return origin === d || origin.startsWith(d);
  })
    ? origin
    : "*";

  return new Headers({
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Request-ID, X-JOE-Token, CF-Access-Client-Id, CF-Access-Client-Secret",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
}

export function addRequestId(headers?: Headers): string {
  const h = headers ?? new Headers();
  const existing = h.get("X-Request-ID") || h.get("cf-ray");
  const id = existing || crypto.randomUUID();
  h.set("X-Request-ID", id);
  return id;
}

export function jsonResponse(
  body: unknown,
  status: number,
  cors: Headers,
  requestId: string,
): Response {
  cors.set("X-Request-ID", requestId);
  cors.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: cors });
}
