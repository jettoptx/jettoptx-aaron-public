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
  /**
   * Optional Cloudflare Access service-token credentials for SpacetimeDB fetches.
   * Both must be set (Worker secrets) or Access headers are omitted.
   */
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  /** Admin MCP API key (set as Worker secret in dashboard) */
  MCP_API_KEY?: string;
  /**
   * SHIELD4 X OAuth allowlist JSON (Worker secret).
   * Shape: { "<xUsername>": { "twinId": "...", "wallet"?: "...", "email"?: "...", "founderBypass"?: boolean } }
   * Empty / unset / invalid → fail-closed for X OAuth (MCP_API_KEY + SpacetimeDB keys still work).
   */
  SHIELD4_ALLOWLIST_JSON?: string;
  /** Helius mainnet RPC for WEALTH8 JTX / NFT checks */
  HELIUS_MAINNET_RPC?: string;
  /**
   * Optional HMAC material for SuperGrok MCP OAuth JWTs.
   * If unset, signing derives from MCP_API_KEY. Never commit a value.
   */
  MCP_OAUTH_SIGNING_KEY?: string;
  /**
   * Optional inbox webhook for public `message_joe` (Worker secrets).
   * Prefer HEDGEHOG_INBOX_URL + HEDGEHOG_INBOX_KEY; JOE_INBOX_* are aliases.
   * Both URL and key must be set to POST. Never commit values. Never invent a URL.
   */
  HEDGEHOG_INBOX_URL?: string;
  HEDGEHOG_INBOX_KEY?: string;
  JOE_INBOX_URL?: string;
  JOE_INBOX_KEY?: string;
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
      "Content-Type, Authorization, X-Request-ID, X-JOE-Token, CF-Access-Client-Id, CF-Access-Client-Secret, X-PAYMENT, PAYMENT-SIGNATURE, x-payment, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
    "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, X-Request-ID",
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
