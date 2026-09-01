/**
 * MCP OAuth 2.1 (RFC 8414 / 7591 / 8707 / 9728) for SuperGrok custom connectors.
 *
 * Phone SuperGrok is OAuth-only and cannot send X-JOE-Token. This Worker is its
 * own authorization server + resource server for the **public** 5-tool subset.
 * Access tokens minted here never authorize /joe/ore, /joe/mcp proxy, census,
 * Helius, Stripe, faucet, or x402.
 *
 * Tokens are HMAC-JWTs (no Durable Object / KV). Signing material is derived
 * from MCP_OAUTH_SIGNING_KEY or MCP_API_KEY — never logged or returned.
 */

import type { GatewayEnv } from "./cors";
import { getCorsHeaders, jsonResponse } from "./cors";

export const PUBLIC_MCP_SCOPE = "mcp:tools";
export const SUPERGROK_MCP_PATH = "/joe/hedgehog";

const ACCESS_TTL_SEC = 3600;
const REFRESH_TTL_SEC = 7 * 24 * 3600;
const CODE_TTL_SEC = 120;
const CLIENT_TTL_SEC = 365 * 24 * 3600;
const CSRF_TTL_SEC = 600;

type JwtTyp = "oauth-client" | "oauth-code" | "oauth-at" | "oauth-rt";

interface JwtPayload {
  typ: JwtTyp;
  iat: number;
  exp: number;
  iss: string;
  [key: string]: unknown;
}

export interface McpOauthAccess {
  ok: true;
  sub: string;
  aud: string;
  scope: string;
}

export function isMcpOauthDiscoveryPath(pathname: string): boolean {
  return (
    pathname === "/.well-known/oauth-protected-resource" ||
    pathname.startsWith("/.well-known/oauth-protected-resource/") ||
    pathname === "/.well-known/oauth-authorization-server" ||
    pathname.startsWith("/.well-known/oauth-authorization-server/") ||
    pathname === "/.well-known/openid-configuration" ||
    pathname === "/mcp/.well-known/oauth-protected-resource" ||
    pathname === "/joe/hedgehog/.well-known/oauth-protected-resource" ||
    pathname === "/joe/hedgehog/.well-known/oauth-authorization-server"
  );
}

export function isMcpOauthProtocolPath(pathname: string): boolean {
  return (
    pathname === "/oauth/authorize" ||
    pathname === "/oauth/authorize/" ||
    pathname === "/oauth/token" ||
    pathname === "/oauth/token/" ||
    pathname === "/oauth/register" ||
    pathname === "/oauth/register/" ||
    pathname === "/authorize" ||
    pathname === "/authorize/" ||
    pathname === "/token" ||
    pathname === "/token/" ||
    pathname === "/register" ||
    pathname === "/register/"
  );
}

export function isPublicOAuthMcpPath(pathname: string): boolean {
  return (
    pathname === "/joe/hedgehog" ||
    pathname === "/joe/hedgehog/" ||
    pathname === "/mcp" ||
    pathname === "/mcp/"
  );
}

export function mcpOauthChallengeHeaders(origin: string, resourcePath: string): string {
  const path = resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`;
  const metadata = `${origin}/.well-known/oauth-protected-resource${path === "/" ? "" : path}`;
  return `Bearer realm="mcp", resource_metadata="${metadata}"`;
}

export function looksLikeMcpOauthJwt(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(b64urlDecodeToString(parts[1])) as { typ?: string };
    return (
      payload.typ === "oauth-at" ||
      payload.typ === "oauth-rt" ||
      payload.typ === "oauth-code" ||
      payload.typ === "oauth-client"
    );
  } catch {
    return false;
  }
}

export async function verifyMcpAccessToken(
  token: string,
  env: GatewayEnv,
  origin: string,
): Promise<McpOauthAccess | { ok: false; error: string }> {
  const payload = await verifyJwt(token, env, origin);
  if (!payload) return { ok: false, error: "invalid_token" };
  if (payload.typ !== "oauth-at") return { ok: false, error: "invalid_token" };

  const aud = typeof payload.aud === "string" ? payload.aud : "";
  if (!isAllowedResource(origin, aud)) return { ok: false, error: "invalid_audience" };

  return {
    ok: true,
    sub: typeof payload.sub === "string" ? payload.sub : "supergrok-public",
    aud,
    scope: typeof payload.scope === "string" ? payload.scope : PUBLIC_MCP_SCOPE,
  };
}

export async function handleMcpOauthRequest(
  request: Request,
  env: GatewayEnv,
  requestId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const cors = getCorsHeaders(request, env);
  cors.set("X-Request-ID", requestId);
  cors.set("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id, X-Request-ID");

  if (isMcpOauthDiscoveryPath(url.pathname)) {
    return discoveryResponse(url, cors, requestId);
  }

  const path = url.pathname.replace(/\/$/, "") || "/";

  if ((path === "/oauth/register" || path === "/register") && request.method === "POST") {
    return registerClient(request, env, url.origin, cors, requestId);
  }

  if ((path === "/oauth/authorize" || path === "/authorize") && request.method === "GET") {
    return authorizeGet(request, env, url, cors, requestId);
  }

  if ((path === "/oauth/authorize" || path === "/authorize") && request.method === "POST") {
    return authorizePost(request, env, url.origin, cors, requestId);
  }

  if ((path === "/oauth/token" || path === "/token") && request.method === "POST") {
    return tokenPost(request, env, url.origin, cors, requestId);
  }

  return jsonResponse({ error: "Not found", requestId }, 404, cors, requestId);
}

function discoveryResponse(url: URL, cors: Headers, requestId: string): Response {
  const origin = url.origin;
  const resource = resourceFromDiscoveryPath(origin, url.pathname);
  const asMeta = authorizationServerMetadata(origin);
  const rsMeta = protectedResourceMetadata(resource, origin);

  if (
    url.pathname.includes("oauth-authorization-server") ||
    url.pathname === "/.well-known/openid-configuration"
  ) {
    return jsonResponse(asMeta, 200, cors, requestId);
  }
  return jsonResponse(rsMeta, 200, cors, requestId);
}

function resourceFromDiscoveryPath(origin: string, pathname: string): string {
  if (pathname.endsWith("/mcp") || pathname.includes("/oauth-protected-resource/mcp")) {
    return `${origin}/mcp`;
  }
  return `${origin}${SUPERGROK_MCP_PATH}`;
}

function authorizationServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    scopes_supported: [PUBLIC_MCP_SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    response_modes_supported: ["query"],
  };
}

function protectedResourceMetadata(resource: string, origin: string): Record<string, unknown> {
  return {
    resource,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: [PUBLIC_MCP_SCOPE],
    resource_documentation: "https://docs.jettoptx.dev/docs/infrastructure/edge-gateway",
  };
}

async function registerClient(
  request: Request,
  env: GatewayEnv,
  origin: string,
  cors: Headers,
  requestId: string,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return oauthError(cors, requestId, 400, "invalid_client_metadata", "Request body must be JSON");
  }

  const uris = normalizeRedirectUris(body.redirect_uris);
  if (uris.length === 0) {
    return oauthError(cors, requestId, 400, "invalid_redirect_uri", "redirect_uris must include at least one https or loopback URI");
  }
  for (const uri of uris) {
    if (!isSafeRedirectUri(uri)) {
      return oauthError(cors, requestId, 400, "invalid_redirect_uri", "redirect_uris must be https, loopback http, or a registered native scheme");
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 80) : "SuperGrok";
  const clientId = await signJwt(
    {
      typ: "oauth-client",
      iat: now,
      exp: now + CLIENT_TTL_SEC,
      iss: origin,
      uris,
      name,
    },
    env,
    origin,
  );
  if (!clientId) {
    return oauthError(cors, requestId, 503, "temporarily_unavailable", "OAuth signing key is not configured");
  }

  return jsonResponse(
    {
      client_id: clientId,
      client_id_issued_at: now,
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
    cors,
    requestId,
  );
}

async function authorizeGet(
  request: Request,
  env: GatewayEnv,
  url: URL,
  cors: Headers,
  requestId: string,
): Promise<Response> {
  const params = url.searchParams;
  const parsed = await parseAuthorizeParams(params, env, url.origin);
  if (!parsed.ok) {
    return authorizeErrorHtml(cors, parsed.error, parsed.description);
  }

  const csrf = crypto.randomUUID();
  const html = consentHtml(parsed, csrf);
  const headers = new Headers(cors);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Frame-Options", "DENY");
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  headers.set("Set-Cookie", csrfCookie(url.protocol === "https:", csrf, CSRF_TTL_SEC));
  headers.set("X-Request-ID", requestId);
  return new Response(html, { status: 200, headers });
}

async function authorizePost(
  request: Request,
  env: GatewayEnv,
  origin: string,
  cors: Headers,
  requestId: string,
): Promise<Response> {
  const form = await readForm(request);
  const cookieCsrf = readCookie(request, "JOE_OAUTH_CSRF");
  const formCsrf = form.get("csrf_token") ?? "";
  if (!cookieCsrf || !formCsrf || cookieCsrf !== formCsrf) {
    return authorizeErrorHtml(cors, "invalid_request", "CSRF token mismatch");
  }
  if (form.get("approve") !== "1") {
    return authorizeErrorHtml(cors, "access_denied", "Authorization denied");
  }

  const params = new URLSearchParams();
  for (const key of [
    "client_id",
    "redirect_uri",
    "code_challenge",
    "code_challenge_method",
    "state",
    "resource",
    "scope",
    "response_type",
  ]) {
    const value = form.get(key);
    if (value) params.set(key, value);
  }

  const parsed = await parseAuthorizeParams(params, env, origin);
  if (!parsed.ok) {
    return authorizeErrorHtml(cors, parsed.error, parsed.description);
  }

  const now = Math.floor(Date.now() / 1000);
  const code = await signJwt(
    {
      typ: "oauth-code",
      iat: now,
      exp: now + CODE_TTL_SEC,
      iss: origin,
      cid: parsed.clientId,
      uri: parsed.redirectUri,
      chl: parsed.codeChallenge,
      chm: parsed.codeChallengeMethod,
      resource: parsed.resource,
      scope: parsed.scope,
      jti: crypto.randomUUID(),
    },
    env,
    origin,
  );
  if (!code) {
    return authorizeErrorHtml(cors, "temporarily_unavailable", "OAuth signing key is not configured");
  }

  const headers = new Headers(cors);
  headers.set("Location", redirectWithCode(parsed.redirectUri, code, parsed.state));
  headers.set("Set-Cookie", csrfCookie(origin.startsWith("https"), "", 0));
  headers.set("Cache-Control", "no-store");
  headers.set("X-Request-ID", requestId);
  return new Response(null, { status: 302, headers });
}

async function tokenPost(
  request: Request,
  env: GatewayEnv,
  origin: string,
  cors: Headers,
  requestId: string,
): Promise<Response> {
  const form = await readForm(request);
  const grantType = form.get("grant_type") ?? "";

  if (grantType === "refresh_token") {
    return refreshGrant(form, env, origin, cors, requestId);
  }
  if (grantType !== "authorization_code") {
    return oauthError(cors, requestId, 400, "unsupported_grant_type", "Use authorization_code or refresh_token");
  }

  const code = form.get("code") ?? "";
  const verifier = form.get("code_verifier") ?? "";
  const redirectUri = form.get("redirect_uri") ?? "";
  const clientId = form.get("client_id") ?? "";
  const resource = form.get("resource") ?? "";

  const payload = await verifyJwt(code, env, origin);
  if (!payload || payload.typ !== "oauth-code") {
    return oauthError(cors, requestId, 400, "invalid_grant", "Authorization code is invalid or expired");
  }
  if (typeof payload.cid === "string" && clientId && payload.cid !== clientId) {
    return oauthError(cors, requestId, 400, "invalid_grant", "client_id does not match the authorization code");
  }
  if (typeof payload.uri === "string" && payload.uri !== redirectUri) {
    return oauthError(cors, requestId, 400, "invalid_grant", "redirect_uri does not match the authorization request");
  }

  const challenge = typeof payload.chl === "string" ? payload.chl : "";
  if (!challenge || !verifier || !(await verifyPkceS256(verifier, challenge))) {
    return oauthError(cors, requestId, 400, "invalid_grant", "PKCE S256 verification failed");
  }

  const aud =
    (typeof payload.resource === "string" && payload.resource) ||
    resource ||
    `${origin}${SUPERGROK_MCP_PATH}`;
  if (!isAllowedResource(origin, aud)) {
    return oauthError(cors, requestId, 400, "invalid_target", "resource is not this public MCP");
  }

  return issueTokenPair(env, origin, aud, cors, requestId);
}

async function refreshGrant(
  form: URLSearchParams,
  env: GatewayEnv,
  origin: string,
  cors: Headers,
  requestId: string,
): Promise<Response> {
  const refresh = form.get("refresh_token") ?? "";
  const payload = await verifyJwt(refresh, env, origin);
  if (!payload || payload.typ !== "oauth-rt") {
    return oauthError(cors, requestId, 400, "invalid_grant", "Refresh token is invalid or expired");
  }
  const aud =
    (typeof payload.aud === "string" && payload.aud) || `${origin}${SUPERGROK_MCP_PATH}`;
  if (!isAllowedResource(origin, aud)) {
    return oauthError(cors, requestId, 400, "invalid_target", "resource is not this public MCP");
  }
  return issueTokenPair(env, origin, aud, cors, requestId);
}

async function issueTokenPair(
  env: GatewayEnv,
  origin: string,
  aud: string,
  cors: Headers,
  requestId: string,
): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const access = await signJwt(
    {
      typ: "oauth-at",
      iat: now,
      exp: now + ACCESS_TTL_SEC,
      iss: origin,
      aud,
      sub: "supergrok-public",
      scope: PUBLIC_MCP_SCOPE,
    },
    env,
    origin,
  );
  const refresh = await signJwt(
    {
      typ: "oauth-rt",
      iat: now,
      exp: now + REFRESH_TTL_SEC,
      iss: origin,
      aud,
      sub: "supergrok-public",
      scope: PUBLIC_MCP_SCOPE,
    },
    env,
    origin,
  );
  if (!access || !refresh) {
    return oauthError(cors, requestId, 503, "temporarily_unavailable", "OAuth signing key is not configured");
  }

  return jsonResponse(
    {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SEC,
      refresh_token: refresh,
      scope: PUBLIC_MCP_SCOPE,
    },
    200,
    cors,
    requestId,
  );
}

interface AuthorizeOk {
  ok: true;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string | null;
  resource: string;
  scope: string;
}

interface AuthorizeErr {
  ok: false;
  error: string;
  description: string;
}

async function parseAuthorizeParams(
  params: URLSearchParams,
  env: GatewayEnv,
  origin: string,
): Promise<AuthorizeOk | AuthorizeErr> {
  const responseType = params.get("response_type") ?? "";
  if (responseType !== "code") {
    return { ok: false, error: "unsupported_response_type", description: "Only response_type=code is supported" };
  }

  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const challenge = params.get("code_challenge") ?? "";
  const method = params.get("code_challenge_method") ?? "";
  if (!clientId || !redirectUri || !challenge) {
    return {
      ok: false,
      error: "invalid_request",
      description: "client_id, redirect_uri, and PKCE code_challenge are required",
    };
  }
  if (method !== "S256") {
    return { ok: false, error: "invalid_request", description: "code_challenge_method must be S256" };
  }
  if (!isSafeRedirectUri(redirectUri)) {
    return { ok: false, error: "invalid_request", description: "redirect_uri is not allowed" };
  }

  const client = await verifyJwt(clientId, env, origin);
  if (!client || client.typ !== "oauth-client") {
    return { ok: false, error: "invalid_client", description: "Unknown client_id — register via POST /oauth/register" };
  }
  const uris = Array.isArray(client.uris) ? client.uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.includes(redirectUri)) {
    return { ok: false, error: "invalid_request", description: "redirect_uri is not registered for this client" };
  }

  const resource = params.get("resource") || `${origin}${SUPERGROK_MCP_PATH}`;
  if (!isAllowedResource(origin, resource)) {
    return { ok: false, error: "invalid_target", description: "resource is not this public MCP" };
  }

  return {
    ok: true,
    clientId,
    clientName: typeof client.name === "string" ? client.name : "MCP client",
    redirectUri,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    state: params.get("state"),
    resource,
    scope: PUBLIC_MCP_SCOPE,
  };
}

function isAllowedResource(origin: string, resource: string): boolean {
  const normalized = stripTrailingSlash(resource);
  const allowed = new Set(
    [origin, `${origin}/mcp`, `${origin}${SUPERGROK_MCP_PATH}`].map(stripTrailingSlash),
  );
  return allowed.has(normalized);
}

function stripTrailingSlash(value: string): string {
  return value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizeRedirectUris(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is string => typeof u === "string" && u.trim().length > 0).map((u) => u.trim());
}

function isSafeRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol === "http:") {
      return (
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]" ||
        parsed.hostname === "::1"
      );
    }
    if (parsed.protocol === "javascript:" || parsed.protocol === "data:" || parsed.protocol === "file:") {
      return false;
    }
    // Native app custom schemes registered via DCR (SuperGrok phone sheet).
    return /^[a-z][a-z0-9+.-]*:$/i.test(parsed.protocol);
  } catch {
    return false;
  }
}

function redirectWithCode(redirectUri: string, code: string, state: string | null): string {
  const sep = redirectUri.includes("?") ? "&" : "?";
  let loc = `${redirectUri}${sep}code=${encodeURIComponent(code)}`;
  if (state) loc += `&state=${encodeURIComponent(state)}`;
  return loc;
}

async function verifyPkceS256(verifier: string, challenge: string): Promise<boolean> {
  if (verifier.length < 43 || verifier.length > 128) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest)) === challenge;
}

async function signJwt(payload: JwtPayload, env: GatewayEnv, origin: string): Promise<string | null> {
  const key = await hmacKey(env);
  if (!key) return null;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...payload, iss: payload.iss || origin }));
  const data = `${header}.${body}`;
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

async function verifyJwt(token: string, env: GatewayEnv, origin: string): Promise<JwtPayload | null> {
  const key = await hmacKey(env);
  if (!key) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  let sig: Uint8Array;
  try {
    sig = b64urlDecode(parts[2]);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify("HMAC", key, sig as BufferSource, new TextEncoder().encode(data));
  if (!ok) return null;
  try {
    const payload = JSON.parse(b64urlDecodeToString(parts[1])) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.iss && payload.iss !== origin) return null;
    return payload;
  } catch {
    return null;
  }
}

async function hmacKey(env: GatewayEnv): Promise<CryptoKey | null> {
  const raw = env.MCP_OAUTH_SIGNING_KEY?.trim() || env.MCP_API_KEY?.trim();
  if (!raw) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`joe-mcp-oauth-v1:${raw}`));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlDecodeToString(value: string): string {
  return new TextDecoder().decode(b64urlDecode(value));
}

async function readForm(request: Request): Promise<URLSearchParams> {
  const ctype = request.headers.get("Content-Type") ?? "";
  if (ctype.includes("application/json")) {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          params.set(k, String(v));
        }
      }
      return params;
    } catch {
      return new URLSearchParams();
    }
  }
  try {
    return new URLSearchParams(await request.text());
  } catch {
    return new URLSearchParams();
  }
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

function csrfCookie(secure: boolean, value: string, maxAge: number): string {
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secure) flags.push("Secure");
  return `JOE_OAUTH_CSRF=${value}; ${flags.join("; ")}`;
}

function oauthError(
  cors: Headers,
  requestId: string,
  status: number,
  error: string,
  description: string,
): Response {
  return jsonResponse({ error, error_description: description, requestId }, status, cors, requestId);
}

function authorizeErrorHtml(cors: Headers, error: string, description: string): Response {
  const headers = new Headers(cors);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cache-Control", "no-store");
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JOE Swarm</title></head><body style="font-family:system-ui;padding:1.5rem;max-width:32rem"><h1>Cannot connect</h1><p>${escapeHtml(description)}</p><p style="color:#666">${escapeHtml(error)}</p></body></html>`,
    { status: 400, headers },
  );
}

function consentHtml(parsed: AuthorizeOk, csrf: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connect JOE Swarm</title>
  <style>
    body{font-family:system-ui,sans-serif;margin:0;padding:1.5rem;background:#0b0f14;color:#e8eef6}
    main{max-width:28rem;margin:0 auto}
    h1{font-size:1.35rem}
    p{line-height:1.45;color:#c5d0dc}
    ul{padding-left:1.2rem;color:#c5d0dc}
    button{width:100%;padding:.9rem;border:0;border-radius:.6rem;background:#f4c15d;color:#1a1408;font-weight:700;font-size:1rem}
    .meta{font-size:.8rem;color:#8b97a6;word-break:break-all}
  </style>
</head>
<body>
  <main>
    <h1>Connect JOE Swarm</h1>
    <p><strong>${escapeHtml(parsed.clientName)}</strong> wants the public JOE Swarm tools. No JOE token paste. No mesh, private RPC, faucet, Stripe, or x402.</p>
    <ul>
      <li>hedgehog_health</li>
      <li>jett_augment_status</li>
      <li>jett_docs_search</li>
      <li>jett_augment_lookup</li>
      <li>jett_edge_diagnose</li>
    </ul>
    <p class="meta">Redirect: ${escapeHtml(parsed.redirectUri)}</p>
    <form method="post" action="/oauth/authorize">
      <input type="hidden" name="csrf_token" value="${escapeHtml(csrf)}">
      <input type="hidden" name="approve" value="1">
      <input type="hidden" name="client_id" value="${escapeHtml(parsed.clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(parsed.redirectUri)}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(parsed.codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="S256">
      <input type="hidden" name="state" value="${escapeHtml(parsed.state ?? "")}">
      <input type="hidden" name="resource" value="${escapeHtml(parsed.resource)}">
      <input type="hidden" name="scope" value="${escapeHtml(parsed.scope)}">
      <input type="hidden" name="response_type" value="code">
      <p><button type="submit">Approve public tools</button></p>
    </form>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
