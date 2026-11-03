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

/**
 * No route on this Worker handles PUT. DELETE is only used by MCP Streamable HTTP
 * session termination (hedgehog /mcp, /joe/hedgehog, /joe/mcp).
 */
const BASE_METHODS = "GET, POST, HEAD, OPTIONS";
const MCP_METHODS = "GET, POST, DELETE, HEAD, OPTIONS";

const BASE_HEADERS = ["Content-Type", "X-Request-ID"];
const AUTH_HEADERS = ["Authorization", "X-JOE-Token"];
const MCP_HEADERS = ["MCP-Protocol-Version", "Mcp-Session-Id", "Last-Event-ID"];
/** x402 payment headers: only advertised on payment-bearing routes. */
const PAYMENT_HEADERS = ["X-PAYMENT", "PAYMENT-SIGNATURE"];

/** MCP transport paths (Streamable HTTP). */
export function isMcpTransportPath(path: string): boolean {
  return /^\/(mcp|joe\/mcp|joe\/hedgehog)(\/|$)/.test(path);
}

/** Routes that accept x402 payment headers (catalog + proxied paid AARON routes). */
export function isPaymentPath(path: string): boolean {
  return /^\/(x402|chat|gaze|task|orphan|jett|aaron)(\/|$)/.test(path) || isMcpTransportPath(path);
}

/** Routes that never take credentials (public metadata / health). */
export function isPublicNoAuthPath(path: string): boolean {
  return path === "/health" || path === "/" || path.startsWith("/.well-known/") || path === "/x402";
}

export function corsPolicyForPath(path: string): { methods: string; headers: string } {
  const h = [...BASE_HEADERS];
  if (!isPublicNoAuthPath(path)) h.push(...AUTH_HEADERS);
  if (isMcpTransportPath(path)) h.push(...MCP_HEADERS);
  if (isPaymentPath(path)) h.push(...PAYMENT_HEADERS);
  return { methods: isMcpTransportPath(path) ? MCP_METHODS : BASE_METHODS, headers: h.join(", ") };
}

/** Security headers applied to every Worker response (does not override per-route values). */
export function applySecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  const h = out.headers;
  h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  h.set("X-Content-Type-Options", "nosniff");
  if (!h.has("Referrer-Policy")) h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (!h.has("X-Frame-Options")) h.set("X-Frame-Options", "DENY");
  if (!h.has("Content-Security-Policy")) {
    // API/JSON surface: nothing should execute. OAuth HTML pages set their own CSP.
    h.set(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
  }
  return out;
}

export function parseCorsAllowlist(env: Pick<GatewayEnv, "CORS_PROD_DOMAINS" | "CORS_DEV_DOMAINS">): string[] {
  return [
    ...(env.CORS_PROD_DOMAINS || "").split(",").map((s) => s.trim()).filter(Boolean),
    ...(env.CORS_DEV_DOMAINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  ];
}

/**
 * True when `origin` matches a CORS_PROD_DOMAINS / CORS_DEV_DOMAINS entry.
 * Exact entries require an exact Origin. Patterns may include `*` (e.g. https://*.jettoptics.ai, http://localhost:*).
 */
export function originMatchesAllowlist(origin: string, allowed: readonly string[]): boolean {
  if (!origin) return false;
  return allowed.some((pattern) => {
    if (pattern.includes("*")) {
      const re = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, "[a-z0-9-]+") + "$");
      return re.test(origin);
    }
    return origin === pattern;
  });
}

export function getCorsHeaders(request: Request, env: GatewayEnv): Headers {
  const origin = request.headers.get("Origin") || "";
  const allowed = parseCorsAllowlist(env);
  const policy = corsPolicyForPath(new URL(request.url).pathname);
  const headers = new Headers({
    "Access-Control-Allow-Methods": policy.methods,
    "Access-Control-Allow-Headers": policy.headers,
    "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, X-Request-ID",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  });

  // Reflect ACAO only for allowlisted Origins. Missing / foreign Origins omit ACAO
  // (never `*`) so browsers block while Origin-less API clients still work.
  // Never pair Access-Control-Allow-Credentials: true with `*`.
  if (originMatchesAllowlist(origin, allowed)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
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
