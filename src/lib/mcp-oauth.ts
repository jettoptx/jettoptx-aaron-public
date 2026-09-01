/**
 * MCP OAuth 2.1 for the SuperGrok /joe/hedgehog porch.
 *
 * Wire format matches Cloudflare workers-oauth-provider / Agents MCP OAuth:
 *   401 WWW-Authenticate → RFC 9728 protected-resource metadata
 *   → RFC 8414 authorization-server metadata → DCR + PKCE code flow
 *
 * Stateless HMAC tokens (no KV / Durable Objects). Signing key is MCP_API_KEY.
 * Authorize requires an existing JOE credential (never public tools).
 * Do not commit secrets. Do not use this module for /joe/ore, x402, or AARON_PATHS.
 */

import type { GatewayEnv } from "./cors";
import { getCorsHeaders, jsonResponse } from "./cors";

/** Identity snapshot carried in signed OAuth codes/tokens. Kept local to avoid auth-gate cycles. */
export interface OAuthIdentity {
  ok: boolean;
  error?: string;
  identity?: string;
  method?: "bearer" | "api-key" | "db-key" | "x-oauth" | "public-health" | "mcp-oauth";
  tier?: "none" | "basic" | "mojo" | "dojo" | "spaceCowboy";
  billingMethod?: "token" | "stripe" | "founder" | "api-key";
}

export const MCP_OAUTH_SCOPE = "mcp:tools";
export const JOE_HEDGEHOG_RESOURCE_PATH = "/joe/hedgehog";

const AUTH_CODE_TTL_SEC = 10 * 60;
const ACCESS_TOKEN_TTL_SEC = 60 * 60;
const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;

type TokenKind = "mcp-oauth-client" | "mcp-oauth-code" | "mcp-oauth-at" | "mcp-oauth-rt";

interface SignedClient {
  typ: "mcp-oauth-client";
  redirect_uris: string[];
  token_endpoint_auth_method: "none";
  client_name?: string;
  iat: number;
}

interface SignedAuthCode {
  typ: "mcp-oauth-code";
  sub: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  identity: string;
  auth_method: OAuthIdentity["method"];
  exp: number;
  iat: number;
}

interface SignedAccessToken {
  typ: "mcp-oauth-at";
  sub: string;
  aud: string;
  scope: string;
  identity: string;
  auth_method: OAuthIdentity["method"];
  client_id: string;
  exp: number;
  iat: number;
}

interface SignedRefreshToken {
  typ: "mcp-oauth-rt";
  sub: string;
  aud: string;
  identity: string;
  auth_method: OAuthIdentity["method"];
  client_id: string;
  exp: number;
  iat: number;
}

function b64urlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function oauthSigningKey(env: GatewayEnv): string | undefined {
  return env.MCP_API_KEY?.replace(/^\uFEFF/, "").replace(/\\r\\n$/, "").trim() || undefined;
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

async function hmacVerify(secret: string, data: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(secret, data);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

async function signPayload<T extends { typ: TokenKind }>(env: GatewayEnv, payload: T): Promise<string | null> {
  const secret = oauthSigningKey(env);
  if (!secret) return null;
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await hmacSign(secret, body);
  return `${body}.${sig}`;
}

async function verifyPayload<T extends { typ: TokenKind }>(
  env: GatewayEnv,
  token: string,
  typ: T["typ"],
): Promise<T | null> {
  const secret = oauthSigningKey(env);
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  if (!(await hmacVerify(secret, body, sig))) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as T;
    if (!parsed || parsed.typ !== typ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function mcpIssuer(url: URL): string {
  return url.origin;
}

export function joeHedgehogResource(url: URL): string {
  return `${url.origin}${JOE_HEDGEHOG_RESOURCE_PATH}`;
}

export function protectedResourceMetadataUrl(url: URL): string {
  return `${url.origin}/.well-known/oauth-protected-resource${JOE_HEDGEHOG_RESOURCE_PATH}`;
}

export function buildWwwAuthenticate(url: URL): string {
  const metadata = protectedResourceMetadataUrl(url);
  return `Bearer realm="OAuth", resource_metadata="${metadata}", scope="${MCP_OAUTH_SCOPE}"`;
}

export function isMcpOAuthDiscoveryPath(pathname: string): boolean {
  return (
    pathname === "/.well-known/oauth-protected-resource" ||
    pathname === "/.well-known/oauth-protected-resource/" ||
    pathname === "/.well-known/oauth-protected-resource/joe/hedgehog" ||
    pathname === "/.well-known/oauth-protected-resource/joe/hedgehog/" ||
    pathname === "/.well-known/oauth-authorization-server" ||
    pathname === "/.well-known/oauth-authorization-server/" ||
    pathname === "/.well-known/oauth-authorization-server/joe/hedgehog" ||
    pathname === "/.well-known/oauth-authorization-server/joe/hedgehog/"
  );
}

export function isMcpOAuthProtocolPath(pathname: string): boolean {
  return (
    pathname === "/authorize" ||
    pathname === "/authorize/" ||
    pathname === "/oauth/token" ||
    pathname === "/oauth/token/" ||
    pathname === "/token" ||
    pathname === "/token/" ||
    pathname === "/oauth/register" ||
    pathname === "/oauth/register/" ||
    pathname === "/register" ||
    pathname === "/register/"
  );
}

function applyOAuthCors(cors: Headers): Headers {
  cors.set("Access-Control-Expose-Headers", "WWW-Authenticate, X-Request-ID");
  cors.set("Cache-Control", "no-store");
  return cors;
}

export function hedgehogUnauthorized(
  request: Request,
  env: GatewayEnv,
  requestId: string,
  error: string,
): Response {
  const url = new URL(request.url);
  const cors = applyOAuthCors(getCorsHeaders(request, env));
  cors.set("WWW-Authenticate", buildWwwAuthenticate(url));
  return jsonResponse({ error, requestId }, 401, cors, requestId);
}

function protectedResourceDocument(url: URL): Record<string, unknown> {
  const resource = joeHedgehogResource(url);
  const issuer = mcpIssuer(url);
  return {
    resource,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [MCP_OAUTH_SCOPE],
    resource_name: "JOE HEDGEHOG MCP",
    resource_documentation: "https://docs.jettoptx.dev",
  };
}

function authorizationServerDocument(url: URL): Record<string, unknown> {
  const issuer = mcpIssuer(url);
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_OAUTH_SCOPE],
    authorization_response_iss_parameter_supported: true,
  };
}

export function handleMcpOAuthDiscovery(
  request: Request,
  env: GatewayEnv,
  requestId: string,
): Response {
  const url = new URL(request.url);
  const cors = applyOAuthCors(getCorsHeaders(request, env));
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed", requestId }, 405, cors, requestId);
  }

  const path = url.pathname.replace(/\/$/, "") || url.pathname;
  if (path.startsWith("/.well-known/oauth-protected-resource")) {
    return jsonResponse(protectedResourceDocument(url), 200, cors, requestId);
  }
  if (path.startsWith("/.well-known/oauth-authorization-server")) {
    return jsonResponse(authorizationServerDocument(url), 200, cors, requestId);
  }
  return jsonResponse({ error: "Not found", requestId }, 404, cors, requestId);
}

function isSafeRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === "https:") return true;
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]")
    ) {
      return true;
    }
    if (/^[a-z][a-z0-9+.-]*:$/i.test(parsed.protocol)) {
      const blocked = new Set(["javascript:", "data:", "file:", "vbscript:", "about:"]);
      return !blocked.has(parsed.protocol.toLowerCase());
    }
    return false;
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function parseFormOrJson(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") out[key] = value;
      else if (Array.isArray(value) && typeof value[0] === "string") out[key] = value[0];
    }
    return out;
  }
  const text = await request.text();
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

function oauthError(
  request: Request,
  env: GatewayEnv,
  requestId: string,
  status: number,
  error: string,
  description: string,
): Response {
  const cors = applyOAuthCors(getCorsHeaders(request, env));
  return jsonResponse({ error, error_description: description, requestId }, status, cors, requestId);
}

async function registerClient(
  request: Request,
  env: GatewayEnv,
  requestId: string,
): Promise<Response> {
  if (request.method !== "POST") {
    return oauthError(request, env, requestId, 405, "invalid_request", "POST required");
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return oauthError(request, env, requestId, 400, "invalid_client_metadata", "JSON body required");
  }

  const rawUris = body.redirect_uris;
  const redirectUris = Array.isArray(rawUris)
    ? rawUris.filter((u): u is string => typeof u === "string" && isSafeRedirectUri(u))
    : [];
  if (redirectUris.length === 0) {
    return oauthError(
      request,
      env,
      requestId,
      400,
      "invalid_redirect_uri",
      "redirect_uris must include at least one https or loopback URI",
    );
  }

  const clientName = typeof body.client_name === "string" ? body.client_name.slice(0, 128) : undefined;
  const issuedAt = Math.floor(Date.now() / 1000);
  const clientId = await signPayload(env, {
    typ: "mcp-oauth-client",
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    client_name: clientName,
    iat: issuedAt,
  } satisfies SignedClient);
  if (!clientId) {
    return oauthError(request, env, requestId, 503, "temporarily_unavailable", "OAuth signing key is not configured");
  }

  const cors = applyOAuthCors(getCorsHeaders(request, env));
  return jsonResponse(
    {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: clientName,
    },
    201,
    cors,
    requestId,
  );
}

function authorizeRedirectError(
  redirectUri: string,
  params: { error: string; description: string; state?: string; issuer?: string },
): Response {
  const target = new URL(redirectUri);
  target.searchParams.set("error", params.error);
  target.searchParams.set("error_description", params.description);
  if (params.state) target.searchParams.set("state", params.state);
  if (params.issuer) target.searchParams.set("iss", params.issuer);
  return Response.redirect(target.toString(), 302);
}

function authorizeHtml(opts: {
  clientName: string;
  resource: string;
  action: string;
  hidden: Record<string, string>;
  error?: string;
}): string {
  const fields = Object.entries(opts.hidden)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`)
    .join("\n");
  const error = opts.error ? `<p class="err">${escapeHtml(opts.error)}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize JOE HEDGEHOG</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0b0f14; color: #e8eef5; }
    main { max-width: 28rem; margin: 2rem auto; padding: 1.25rem; }
    h1 { font-size: 1.25rem; }
    label, input, button { display: block; width: 100%; }
    input { margin: 0.4rem 0 1rem; padding: 0.65rem; border-radius: 8px; border: 1px solid #334; background: #11181f; color: inherit; }
    button { padding: 0.75rem; border: 0; border-radius: 8px; background: #3d8bfd; color: #041018; font-weight: 600; }
    .err { color: #ff8a8a; }
    .meta { color: #9aa8b5; font-size: 0.9rem; }
  </style>
</head>
<body>
  <main>
    <h1>Connect SuperGrok to JOE HEDGEHOG</h1>
    <p class="meta">${escapeHtml(opts.clientName)} wants tools at ${escapeHtml(opts.resource)}.</p>
    <p class="meta">Paste a JOE API token (same credential Computer stdio sends as Authorization: Bearer). This porch never lists tools without a valid token.</p>
    ${error}
    <form method="post" action="${escapeHtml(opts.action)}">
      ${fields}
      <label for="joe_token">JOE API token</label>
      <input id="joe_token" name="joe_token" type="password" autocomplete="off" required />
      <button type="submit">Authorize HEDGEHOG tools</button>
    </form>
  </main>
</body>
</html>`;
}

function authorizePage(
  request: Request,
  env: GatewayEnv,
  html: string,
  status = 200,
): Response {
  const cors = applyOAuthCors(getCorsHeaders(request, env));
  cors.set("Content-Type", "text/html; charset=utf-8");
  cors.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'");
  cors.set("X-Frame-Options", "DENY");
  cors.set("X-Content-Type-Options", "nosniff");
  return new Response(html, { status, headers: cors });
}

async function handleAuthorize(
  request: Request,
  env: GatewayEnv,
  requestId: string,
  validateJoeToken: (request: Request, pathname: string, env: GatewayEnv) => Promise<OAuthIdentity>,
): Promise<Response> {
  const url = new URL(request.url);
  const incoming = request.method === "POST" ? await parseFormOrJson(request) : Object.fromEntries(url.searchParams);
  const clientId = incoming.client_id ?? "";
  const redirectUri = incoming.redirect_uri ?? "";
  const responseType = incoming.response_type ?? "code";
  const state = incoming.state ?? "";
  const codeChallenge = incoming.code_challenge ?? "";
  const codeChallengeMethod = incoming.code_challenge_method ?? "";
  const resource = incoming.resource || joeHedgehogResource(url);
  const issuer = mcpIssuer(url);

  const client = await verifyPayload<SignedClient>(env, clientId, "mcp-oauth-client");
  if (!client) {
    return authorizePage(
      request,
      env,
      authorizeHtml({
        clientName: "Unknown client",
        resource,
        action: "/authorize",
        hidden: {},
        error: "Unknown or expired OAuth client. Re-register with POST /oauth/register.",
      }),
      400,
    );
  }
  if (!client.redirect_uris.includes(redirectUri) || !isSafeRedirectUri(redirectUri)) {
    return authorizePage(
      request,
      env,
      authorizeHtml({
        clientName: client.client_name ?? "MCP client",
        resource,
        action: "/authorize",
        hidden: {},
        error: "redirect_uri is not registered for this client.",
      }),
      400,
    );
  }
  if (responseType !== "code") {
    return authorizeRedirectError(redirectUri, {
      error: "unsupported_response_type",
      description: "Only response_type=code is supported",
      state,
      issuer,
    });
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return authorizeRedirectError(redirectUri, {
      error: "invalid_request",
      description: "PKCE S256 code_challenge is required",
      state,
      issuer,
    });
  }
  const expectedResource = joeHedgehogResource(url);
  if (resource !== expectedResource && resource !== `${url.origin}/mcp`) {
    return authorizeRedirectError(redirectUri, {
      error: "invalid_target",
      description: `resource must be ${expectedResource}`,
      state,
      issuer,
    });
  }

  const hidden = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    resource: expectedResource,
  };

  if (request.method === "GET") {
    return authorizePage(
      request,
      env,
      authorizeHtml({
        clientName: client.client_name ?? "SuperGrok",
        resource: expectedResource,
        action: "/authorize",
        hidden,
      }),
    );
  }
  if (request.method !== "POST") {
    return oauthError(request, env, requestId, 405, "invalid_request", "GET or POST required");
  }

  const joeToken = incoming.joe_token?.trim() ?? "";
  if (!joeToken) {
    return authorizePage(
      request,
      env,
      authorizeHtml({
        clientName: client.client_name ?? "SuperGrok",
        resource: expectedResource,
        action: "/authorize",
        hidden,
        error: "JOE API token is required.",
      }),
      401,
    );
  }

  const gateRequest = new Request(expectedResource, {
    method: "POST",
    headers: { Authorization: `Bearer ${joeToken}` },
  });
  const auth = await validateJoeToken(gateRequest, JOE_HEDGEHOG_RESOURCE_PATH, env);
  if (!auth.ok || auth.method === "mcp-oauth") {
    return authorizePage(
      request,
      env,
      authorizeHtml({
        clientName: client.client_name ?? "SuperGrok",
        resource: expectedResource,
        action: "/authorize",
        hidden,
        error: auth.error ?? "JOE API token was rejected.",
      }),
      401,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const code = await signPayload(env, {
    typ: "mcp-oauth-code",
    sub: auth.identity ?? "joe",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    resource: expectedResource,
    identity: auth.identity ?? "joe",
    auth_method: auth.method,
    exp: now + AUTH_CODE_TTL_SEC,
    iat: now,
  } satisfies SignedAuthCode);
  if (!code) {
    return authorizeRedirectError(redirectUri, {
      error: "temporarily_unavailable",
      description: "OAuth signing key is not configured",
      state,
      issuer,
    });
  }

  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  if (state) target.searchParams.set("state", state);
  target.searchParams.set("iss", issuer);
  return Response.redirect(target.toString(), 302);
}

async function sha256B64url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return b64urlEncode(new Uint8Array(digest));
}

async function handleToken(
  request: Request,
  env: GatewayEnv,
  requestId: string,
): Promise<Response> {
  if (request.method !== "POST") {
    return oauthError(request, env, requestId, 405, "invalid_request", "POST required");
  }
  const form = await parseFormOrJson(request);
  const grantType = form.grant_type ?? "";
  const url = new URL(request.url);
  const expectedResource = joeHedgehogResource(url);

  if (grantType === "authorization_code") {
    const code = form.code ?? "";
    const redirectUri = form.redirect_uri ?? "";
    const clientId = form.client_id ?? "";
    const verifier = form.code_verifier ?? "";
    const resource = form.resource || expectedResource;
    const parsed = await verifyPayload<SignedAuthCode>(env, code, "mcp-oauth-code");
    if (!parsed || parsed.exp <= Math.floor(Date.now() / 1000)) {
      return oauthError(request, env, requestId, 400, "invalid_grant", "Authorization code is invalid or expired");
    }
    if (parsed.client_id !== clientId || parsed.redirect_uri !== redirectUri) {
      return oauthError(request, env, requestId, 400, "invalid_grant", "Authorization code does not match client/redirect");
    }
    if (resource !== parsed.resource) {
      return oauthError(request, env, requestId, 400, "invalid_target", "resource does not match the authorization grant");
    }
    const challenge = await sha256B64url(verifier);
    if (!verifier || challenge !== parsed.code_challenge) {
      return oauthError(request, env, requestId, 400, "invalid_grant", "PKCE verification failed");
    }

    const now = Math.floor(Date.now() / 1000);
    const access = await signPayload(env, {
      typ: "mcp-oauth-at",
      sub: parsed.identity,
      aud: parsed.resource,
      scope: MCP_OAUTH_SCOPE,
      identity: parsed.identity,
      auth_method: parsed.auth_method,
      client_id: parsed.client_id,
      exp: now + ACCESS_TOKEN_TTL_SEC,
      iat: now,
    } satisfies SignedAccessToken);
    const refresh = await signPayload(env, {
      typ: "mcp-oauth-rt",
      sub: parsed.identity,
      aud: parsed.resource,
      identity: parsed.identity,
      auth_method: parsed.auth_method,
      client_id: parsed.client_id,
      exp: now + REFRESH_TOKEN_TTL_SEC,
      iat: now,
    } satisfies SignedRefreshToken);
    if (!access || !refresh) {
      return oauthError(request, env, requestId, 503, "temporarily_unavailable", "OAuth signing key is not configured");
    }
    const cors = applyOAuthCors(getCorsHeaders(request, env));
    return jsonResponse(
      {
        access_token: access,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_SEC,
        refresh_token: refresh,
        scope: MCP_OAUTH_SCOPE,
        resource: parsed.resource,
      },
      200,
      cors,
      requestId,
    );
  }

  if (grantType === "refresh_token") {
    const refreshToken = form.refresh_token ?? "";
    const parsed = await verifyPayload<SignedRefreshToken>(env, refreshToken, "mcp-oauth-rt");
    if (!parsed || parsed.exp <= Math.floor(Date.now() / 1000)) {
      return oauthError(request, env, requestId, 400, "invalid_grant", "Refresh token is invalid or expired");
    }
    const resource = form.resource || parsed.aud;
    if (resource !== parsed.aud) {
      return oauthError(request, env, requestId, 400, "invalid_target", "resource does not match the refresh token");
    }
    const now = Math.floor(Date.now() / 1000);
    const access = await signPayload(env, {
      typ: "mcp-oauth-at",
      sub: parsed.identity,
      aud: parsed.aud,
      scope: MCP_OAUTH_SCOPE,
      identity: parsed.identity,
      auth_method: parsed.auth_method,
      client_id: parsed.client_id,
      exp: now + ACCESS_TOKEN_TTL_SEC,
      iat: now,
    } satisfies SignedAccessToken);
    if (!access) {
      return oauthError(request, env, requestId, 503, "temporarily_unavailable", "OAuth signing key is not configured");
    }
    const cors = applyOAuthCors(getCorsHeaders(request, env));
    return jsonResponse(
      {
        access_token: access,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_SEC,
        scope: MCP_OAUTH_SCOPE,
        resource: parsed.aud,
      },
      200,
      cors,
      requestId,
    );
  }

  return oauthError(
    request,
    env,
    requestId,
    400,
    "unsupported_grant_type",
    "Only authorization_code and refresh_token are supported",
  );
}

export async function handleMcpOAuthProtocol(
  request: Request,
  env: GatewayEnv,
  requestId: string,
  validateJoeToken: (request: Request, pathname: string, env: GatewayEnv) => Promise<OAuthIdentity>,
): Promise<Response> {
  const pathname = new URL(request.url).pathname.replace(/\/$/, "") || "/";
  if (pathname === "/oauth/register" || pathname === "/register") {
    return registerClient(request, env, requestId);
  }
  if (pathname === "/authorize") {
    return handleAuthorize(request, env, requestId, validateJoeToken);
  }
  if (pathname === "/oauth/token" || pathname === "/token") {
    return handleToken(request, env, requestId);
  }
  return oauthError(request, env, requestId, 404, "invalid_request", "Unknown OAuth endpoint");
}

export async function verifyMcpOAuthAccessToken(
  token: string,
  requestUrl: string,
  env: GatewayEnv,
): Promise<OAuthIdentity | null> {
  const parsed = await verifyPayload<SignedAccessToken>(env, token, "mcp-oauth-at");
  if (!parsed) return null;
  if (parsed.exp <= Math.floor(Date.now() / 1000)) return null;
  const url = new URL(requestUrl);
  const expected = joeHedgehogResource(url);
  if (parsed.aud !== expected && parsed.aud !== `${url.origin}/mcp`) return null;
  return {
    ok: true,
    identity: parsed.identity,
    method: "mcp-oauth",
    tier: "spaceCowboy",
    billingMethod: "api-key",
  };
}

export function asHedgehogMcpRequest(request: Request): Request {
  const url = new URL(request.url);
  url.pathname = "/mcp";
  return new Request(url, request);
}
