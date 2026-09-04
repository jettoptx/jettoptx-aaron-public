/**
 * SuperGrok phone sheet is OAuth-only. After DCR + PKCE + consent,
 * POST /joe/hedgehog tools/list must return the public 6 tools locally
 * (never proxy to AARON, never unlock /joe/ore).
 *
 * Run: npm test
 */
import worker from "./index";
import type { GatewayEnv } from "./lib/cors";
import { MCP_TOOLS } from "./data/augment-registry";

const AARON_ORIGIN = "https://aaron.example.test";
const HEDGEHOG_ORIGIN = "https://hedgehog.example.test";
const JOE_TOKEN = "test-joe-token";
const ORIGIN = "https://mcp.jettoptics.ai";
const MCP_URL = `${ORIGIN}/joe/hedgehog`;

const env: GatewayEnv = {
  AARON_ORIGIN,
  HEDGEHOG_ORIGIN,
  ENV: "test",
  MCP_API_KEY: JOE_TOKEN,
};

const ctx = {} as ExecutionContext;

type FetchCall = { url: string; method: string };
let fetchCalls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

function installFetchMock(): void {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (
      init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET")
    ).toUpperCase();
    fetchCalls.push({ url, method });
    if (url.startsWith(AARON_ORIGIN) || url.startsWith(HEDGEHOG_ORIGIN)) {
      return new Response(JSON.stringify({ source: "aaron-origin", tools: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("denied", { status: 401 });
  }) as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    throw new Error(msg);
  }
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

function setCookies(res: Response): string[] {
  if (typeof res.headers.getSetCookie === "function") {
    return res.headers.getSetCookie();
  }
  const raw = res.headers.get("Set-Cookie");
  return raw ? [raw] : [];
}

function cookieFrom(res: Response): string {
  for (const raw of setCookies(res)) {
    if (/Max-Age=0(?:;|$)/.test(raw)) continue;
    const match = raw.match(/JOE_OAUTH_CSRF=([^;]*)/);
    if (match && match[1]) return `JOE_OAUTH_CSRF=${match[1]}`;
  }
  return "";
}

function csrfFromHtml(html: string): string {
  const match = html.match(/name="csrf_token" value="([^"]+)"/);
  return match?.[1] ?? "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Successful Approve: HTML 200 bounce (not a bare 302) so Grok's webview can navigate. */
async function assertApproveRedirectHtml(res: Response, redirectUri: string): Promise<string> {
  assert(res.status === 200, `approve → HTML 200 (not bare 302), got ${res.status}`);
  assert((res.headers.get("Content-Type") ?? "").includes("text/html"), "approve Content-Type is HTML");
  const loc = res.headers.get("Location") ?? "";
  assert(loc.startsWith(`${redirectUri}?`) || loc.startsWith(`${redirectUri}&`), `Location redirect URI, got ${loc}`);
  assert(loc.includes("code="), "Location includes authorization code");
  const html = await res.text();
  assert(html.includes(redirectUri), "HTML body contains the redirect URI");
  assert(html.includes(escapeHtml(loc)), "HTML escapes the full redirect URL");
  assert(/http-equiv=["']refresh["']/i.test(html), "meta refresh fallback");
  assert(html.includes(`content="0;url=${escapeHtml(loc)}"`), "meta refresh targets the exact redirect URL");
  assert(html.includes("window.top.location"), "top-level JS assigns window.top.location");
  assert(html.includes("window.location.replace"), "JS calls window.location.replace");
  assert(/<a[^>]+href="[^"]+"[^>]*>Continue<\/a>/i.test(html), "visible Continue link");
  assert(html.includes(`href="${escapeHtml(loc)}"`), "Continue href is the exact redirect URL");
  assert(!html.includes("CSRF token mismatch"), "success page is not the CSRF error page");
  return loc;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  assert(parts.length === 3, `signed CSRF is a JWT, got ${token.slice(0, 48)}`);
  const pad = parts[1].length % 4 === 0 ? "" : "=".repeat(4 - (parts[1].length % 4));
  return JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(
        atob(parts[1].replace(/-/g, "+").replace(/_/g, "/") + pad),
        (c) => c.charCodeAt(0),
      ),
    ),
  ) as Record<string, unknown>;
}

function assertSignedCsrf(token: string, expect?: { cid?: string; uri?: string; state?: string }): void {
  const json = decodeJwtPayload(token);
  assert(json.typ === "oauth-csrf", `CSRF typ=oauth-csrf, got ${json.typ}`);
  assert(typeof json.exp === "number" && json.exp > Date.now() / 1000, "CSRF TTL (exp) present and live");
  assert(typeof json.cid === "string" && json.cid.length > 0, "CSRF payload includes client_id");
  assert(typeof json.uri === "string" && json.uri.length > 0, "CSRF payload includes redirect_uri");
  assert(typeof json.state === "string", "CSRF payload includes state");
  assert(typeof json.nonce === "string" && json.nonce.length > 10, "CSRF payload includes nonce");
  if (expect?.cid) assert(json.cid === expect.cid, "CSRF cid matches authorize client_id");
  if (expect?.uri) assert(json.uri === expect.uri, "CSRF uri matches authorize redirect_uri");
  if (expect?.state !== undefined) assert(json.state === expect.state, "CSRF state matches authorize state");
}

async function mintExpiredConsentCsrf(claims: {
  cid: string;
  uri: string;
  state: string;
}): Promise<string> {
  const raw = env.MCP_API_KEY?.trim() ?? "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`joe-mcp-oauth-v1:${raw}`));
  const key = await crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        typ: "oauth-csrf",
        iat: now - 700,
        exp: now - 60,
        iss: ORIGIN,
        cid: claims.cid,
        uri: claims.uri,
        state: claims.state,
        nonce: crypto.randomUUID(),
      }),
    ),
  );
  const data = `${header}.${body}`;
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

function assertCsrfCookieAttrs(res: Response, host: string): void {
  const all = setCookies(res);
  const live = all.find((c) => /JOE_OAUTH_CSRF=/.test(c) && !/Max-Age=0(?:;|$)/.test(c)) ?? "";
  const joined = all.join("\n");
  assert(live.length > 0, `live CSRF Set-Cookie, got ${joined}`);
  assert(live.includes("Path=/oauth"), `CSRF Path=/oauth covers GET+POST /oauth/authorize, got ${live}`);
  assert(!/Path=\/(;|$)/.test(live.replace("Path=/oauth", "")), "live CSRF must not use Path=/");
  assert(live.includes("HttpOnly"), "CSRF HttpOnly");
  assert(live.includes("SameSite=None"), "best-effort CSRF cookie stays SameSite=None; Secure (not the Approve authenticator)");
  assert(live.includes("Secure"), "SameSite=None requires Secure");
  assert(!/SameSite=Lax/i.test(live), "live HTTPS CSRF must not be SameSite=Lax (dropped on cross-site POST)");
  assert(!/SameSite=Strict/i.test(joined), "CSRF must not be SameSite=Strict");
  assert(!/Domain=\.jettoptics\.ai/i.test(joined), "CSRF must not use parent Domain=.jettoptics.ai");
  assert(!/Domain=jettoptics\.ai(;|$)/i.test(joined), "CSRF must not use parent Domain=jettoptics.ai");
  if (host === "mcp.jettoptics.ai") {
    assert(live.includes("Domain=mcp.jettoptics.ai"), `CSRF Domain=mcp.jettoptics.ai, got ${live}`);
  }
  assert(
    all.some((c) => /Max-Age=0/.test(c) && c.includes("Path=/") && !c.includes("Path=/oauth")),
    `GET must expire leftover Path=/ CSRF cookies, got ${joined}`,
  );
}

async function completeOAuth(): Promise<string> {
  const { verifier, challenge } = await pkce();
  const redirectUri = "https://grok.com/oauth/callback";

  const reg = await worker.fetch(
    new Request(`${ORIGIN}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "SuperGrok",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      }),
    }),
    env,
    ctx,
  );
  assert(reg.status === 201, `DCR → 201, got ${reg.status}`);
  const client = (await reg.json()) as { client_id: string };
  assert(typeof client.client_id === "string" && client.client_id.length > 20, "DCR client_id");

  const authorizeUrl = new URL(`${ORIGIN}/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", client.client_id);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", "st-1");
  authorizeUrl.searchParams.set("resource", MCP_URL);
  authorizeUrl.searchParams.set("scope", "mcp:tools");

  const consent = await worker.fetch(new Request(authorizeUrl.toString()), env, ctx);
  assert(consent.status === 200, `consent HTML → 200, got ${consent.status}`);
  const html = await consent.text();
  assert(html.includes("hedgehog_health"), "consent lists public tools");
  assert(html.includes("message_joe"), "consent lists message_joe");
  assert(!html.toLowerCase().includes("helius"), "consent must not mention Helius");
  const cookie = cookieFrom(consent);
  assert(cookie.length > 0, "best-effort CSRF cookie still set");
  assertCsrfCookieAttrs(consent, "mcp.jettoptics.ai");
  const formCsrf = csrfFromHtml(html);
  assert(formCsrf.length > 20, "consent HTML has csrf_token");
  assertSignedCsrf(formCsrf);

  const form = new URLSearchParams({
    csrf_token: formCsrf,
    approve: "1",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st-1",
    resource: MCP_URL,
    scope: "mcp:tools",
    response_type: "code",
  });

  // Grok webview: Cookie jar empty / third-party blocked. Signed form field is enough.
  const noCookie = await worker.fetch(
    new Request(`${ORIGIN}/oauth/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }),
    env,
    ctx,
  );
  const loc = await assertApproveRedirectHtml(noCookie, redirectUri);
  const redirected = new URL(loc);
  const code = redirected.searchParams.get("code");
  assert(code, "authorization code");
  assert(redirected.searchParams.get("state") === "st-1", "state echoed");

  const tokenRes = await worker.fetch(
    new Request(`${ORIGIN}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: client.client_id,
        code_verifier: verifier,
        resource: MCP_URL,
      }).toString(),
    }),
    env,
    ctx,
  );
  assert(tokenRes.status === 200, `token → 200, got ${tokenRes.status} ${await tokenRes.clone().text()}`);
  const tokens = (await tokenRes.json()) as { access_token?: string; token_type?: string };
  assert(tokens.token_type === "Bearer" && tokens.access_token, "Bearer access_token");
  return tokens.access_token as string;
}

async function assertConsentCsrfMatrix(): Promise<void> {
  const { challenge } = await pkce();
  const redirectUri = "https://grok.com/oauth/callback";
  const reg = await worker.fetch(
    new Request(`${ORIGIN}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "SuperGrok",
        redirect_uris: [redirectUri, "https://grok.com/oauth/other"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      }),
    }),
    env,
    ctx,
  );
  assert(reg.status === 201, `CSRF matrix DCR → 201, got ${reg.status}`);
  const client = (await reg.json()) as { client_id: string };

  const authorizeUrl = new URL(`${ORIGIN}/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", client.client_id);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", "st-csrf");
  authorizeUrl.searchParams.set("resource", MCP_URL);
  authorizeUrl.searchParams.set("scope", "mcp:tools");

  const consent = await worker.fetch(new Request(authorizeUrl.toString()), env, ctx);
  assert(consent.status === 200, `CSRF matrix consent → 200, got ${consent.status}`);
  const html = await consent.text();
  const formCsrf = csrfFromHtml(html);
  const cookie = cookieFrom(consent);
  assertSignedCsrf(formCsrf, { cid: client.client_id, uri: redirectUri, state: "st-csrf" });

  const base = {
    approve: "1",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st-csrf",
    resource: MCP_URL,
    scope: "mcp:tools",
    response_type: "code",
  };

  async function postAuthorize(
    body: Record<string, string>,
    cookieHeader?: string,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (cookieHeader) headers.Cookie = cookieHeader;
    return worker.fetch(
      new Request(`${ORIGIN}/oauth/authorize`, {
        method: "POST",
        headers,
        body: new URLSearchParams(body).toString(),
      }),
      env,
      ctx,
    );
  }

  const forged = await postAuthorize({ ...base, csrf_token: "forged-not-signed" });
  assert(forged.status === 400, `forged form CSRF → 400, got ${forged.status}`);
  const forgedHtml = await forged.text();
  assert(forgedHtml.includes("CSRF token mismatch"), "forged mismatch copy");
  assert(forgedHtml.includes("Cannot connect"), "forged CSRF is the error page");
  assert(!forgedHtml.includes("window.location.replace"), "forged CSRF is not the approve bounce page");
  assert(!forgedHtml.includes("http-equiv"), "forged CSRF has no meta refresh");

  const tampered = `${formCsrf.slice(0, -2)}aa`;
  const tamperedRes = await postAuthorize({ ...base, csrf_token: tampered });
  assert(tamperedRes.status === 400, `tampered CSRF JWT → 400, got ${tamperedRes.status}`);

  const rebound = await postAuthorize({
    ...base,
    csrf_token: formCsrf,
    redirect_uri: "https://grok.com/oauth/other",
  });
  assert(rebound.status === 400, `mismatched redirect_uri → 400, got ${rebound.status}`);
  assert((await rebound.text()).includes("CSRF token mismatch"), "redirect_uri mismatch is CSRF fail");

  const wrongClient = await postAuthorize({
    ...base,
    csrf_token: formCsrf,
    client_id: `${client.client_id}-x`,
  });
  assert(wrongClient.status === 400, `mismatched client_id → 400, got ${wrongClient.status}`);
  assert((await wrongClient.text()).includes("CSRF token mismatch"), "client_id mismatch is CSRF fail");

  const wrongState = await postAuthorize({
    ...base,
    csrf_token: formCsrf,
    state: "st-attacker",
  });
  assert(wrongState.status === 400, `mismatched state → 400, got ${wrongState.status}`);
  assert((await wrongState.text()).includes("CSRF token mismatch"), "state mismatch is CSRF fail");

  const expiredToken = await mintExpiredConsentCsrf({
    cid: client.client_id,
    uri: redirectUri,
    state: "st-csrf",
  });
  const expired = await postAuthorize({ ...base, csrf_token: expiredToken });
  assert(expired.status === 400, `expired signed CSRF → 400, got ${expired.status}`);
  assert((await expired.text()).includes("CSRF token mismatch"), "expired CSRF fails");

  const cookieOnly = await postAuthorize(base, cookie);
  assert(cookieOnly.status === 400, `cookie alone without form CSRF → 400, got ${cookieOnly.status}`);
  assert((await cookieOnly.text()).includes("CSRF token mismatch"), "form-required: cookie alone fails");

  const staleCookieUnsignedForm = await postAuthorize(
    { ...base, csrf_token: cookie.split("=")[1] ?? "stale" },
    "JOE_OAUTH_CSRF=stale-leftover-path-root",
  );
  assert(
    staleCookieUnsignedForm.status === 400,
    `stale cookie + unsigned form → 400, got ${staleCookieUnsignedForm.status}`,
  );

  const grokWebview = await postAuthorize({ ...base, csrf_token: formCsrf });
  await assertApproveRedirectHtml(grokWebview, redirectUri);

  const leftoverOk = await postAuthorize(
    { ...base, csrf_token: formCsrf },
    "JOE_OAUTH_CSRF=stale-leftover-path-root",
  );
  // Second approve of the same consent is fine (stateless JWT). Leftover cookie must not block.
  await assertApproveRedirectHtml(leftoverOk, redirectUri);
}

async function run(): Promise<void> {
  const expectedTools = MCP_TOOLS.map((t) => t.name);
  assert(
    JSON.stringify(expectedTools) ===
      JSON.stringify([
        "hedgehog_health",
        "jett_augment_status",
        "jett_docs_search",
        "jett_augment_lookup",
        "jett_edge_diagnose",
        "message_joe",
      ]),
    "public tool list is the SuperGrok 6-tool set including message_joe",
  );

  installFetchMock();
  try {
    const unauth = await worker.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
      env,
      ctx,
    );
    assert(unauth.status === 401, `no token → 401, got ${unauth.status}`);
    const www = unauth.headers.get("WWW-Authenticate") ?? "";
    assert(
      www.includes("resource_metadata=") && www.includes("oauth-protected-resource"),
      `WWW-Authenticate resource_metadata, got ${www}`,
    );
    assert(
      fetchCalls.every((c) => !c.url.startsWith(AARON_ORIGIN)),
      "unauth must not proxy",
    );

    const rs = await worker.fetch(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/joe/hedgehog`),
      env,
      ctx,
    );
    assert(rs.status === 200, `PRM → 200, got ${rs.status}`);
    const rsBody = (await rs.json()) as { resource?: string; authorization_servers?: string[] };
    assert(rsBody.resource === MCP_URL, `resource ${rsBody.resource}`);
    assert(rsBody.authorization_servers?.[0] === ORIGIN, "authorization_servers");

    const as = await worker.fetch(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`), env, ctx);
    assert(as.status === 200, `ASM → 200, got ${as.status}`);
    const asBody = (await as.json()) as {
      registration_endpoint?: string;
      code_challenge_methods_supported?: string[];
    };
    assert(asBody.registration_endpoint === `${ORIGIN}/oauth/register`, "DCR endpoint advertised");
    assert(asBody.code_challenge_methods_supported?.includes("S256"), "PKCE S256");
    assert(
      (asBody as { client_id_metadata_document_supported?: boolean })
        .client_id_metadata_document_supported === true,
      "CIMD advertised for SuperGrok",
    );
    assert(as.status < 300, "AS metadata must not 301");
    assert(rs.status < 300, "PRM must not 301");

    const pathRs = await worker.fetch(
      new Request(`${ORIGIN}/joe/hedgehog/.well-known/oauth-protected-resource`),
      env,
      ctx,
    );
    assert(pathRs.status === 200, "path-style PRM");

    fetchCalls = [];
    const porchHealth = await worker.fetch(new Request(`${ORIGIN}/health`), env, ctx);
    assert(porchHealth.status === 200, `GET /health → 200, got ${porchHealth.status}`);
    const porchHealthJson = (await porchHealth.json()) as { inboxConfigured?: boolean; mcpTools?: number };
    assert(porchHealthJson.inboxConfigured === false, "unset inbox → inboxConfigured false (no values leaked)");
    assert(porchHealthJson.mcpTools === 6, "health lists 6 public tools");
    const porchHealthText = JSON.stringify(porchHealthJson);
    assert(!porchHealthText.toLowerCase().includes("inbox-test-key"), "health must not leak inbox key");

    const gw = await worker.fetch(new Request(`${ORIGIN}/.well-known/joe-gateway`), env, ctx);
    assert(gw.status === 200, "joe-gateway");
    const gwJson = (await gw.json()) as { inboxConfigured?: boolean };
    assert(gwJson.inboxConfigured === false, "joe-gateway inboxConfigured false when unset");

    const healthSet = await worker.fetch(
      new Request(`${ORIGIN}/health`),
      { ...env, HEDGEHOG_INBOX_URL: "https://inbox.example.test/joe", HEDGEHOG_INBOX_KEY: "inbox-test-key" },
      ctx,
    );
    const healthSetJson = (await healthSet.json()) as { inboxConfigured?: boolean };
    assert(healthSetJson.inboxConfigured === true, "inbox secrets present → inboxConfigured true");
    const healthSetText = JSON.stringify(healthSetJson);
    assert(!healthSetText.includes("inbox-test-key"), "inboxConfigured must not echo the key");
    assert(!healthSetText.includes("inbox.example.test"), "inboxConfigured must not echo the URL");

    fetchCalls = [];
    await assertConsentCsrfMatrix();
    const access = await completeOAuth();
    assert(
      fetchCalls.every((c) => !c.url.startsWith(AARON_ORIGIN) && !c.url.includes("api.x.com")),
      "OAuth handshake must not call AARON or X",
    );

    fetchCalls = [];
    const listed = await worker.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      }),
      env,
      ctx,
    );
    assert(listed.status === 200, `OAuth tools/list → 200, got ${listed.status}`);
    const listedBody = (await listed.json()) as { result?: { tools?: Array<{ name: string }> } };
    const names = (listedBody.result?.tools ?? []).map((t) => t.name);
    assert(names.length === 6, `6 tools, got ${names.length}: ${names.join(",")}`);
    assert(names.includes("message_joe"), "tools/list includes message_joe");
    for (const name of expectedTools) {
      assert(names.includes(name), `tools/list includes ${name}`);
    }
    assert(fetchCalls.length === 0, "OAuth tools/list is local — must not proxy");

    fetchCalls = [];
    const health = await worker.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "hedgehog_health", arguments: {} },
        }),
      }),
      env,
      ctx,
    );
    assert(health.status === 200, `OAuth tools/call → 200, got ${health.status}`);
    const healthBody = (await health.json()) as { result?: { content?: Array<{ text?: string }> } };
    const healthText = healthBody.result?.content?.[0]?.text ?? "";
    assert(healthText.includes("hedgehog_health"), "health payload lists tools");
    assert(!healthText.includes(JOE_TOKEN), "must not echo signing material");
    assert(fetchCalls.length === 0, "tools/call stays on the Worker");

    fetchCalls = [];
    const msg = await worker.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "message_joe", arguments: { message: "hello from SuperGrok" } },
        }),
      }),
      env,
      ctx,
    );
    assert(msg.status === 200, `message_joe → 200, got ${msg.status}`);
    const msgBody = (await msg.json()) as { result?: { content?: Array<{ text?: string }> }; error?: unknown };
    assert(!msgBody.error, "message_joe must not fail when inbox secrets are unset");
    const msgText = msgBody.result?.content?.[0]?.text ?? "";
    assert(msgText.includes("accepted"), "message_joe acks");
    assert(msgText.includes("not woken") || msgText.includes("unset"), "unset inbox does not wake Joe");
    assert(
      fetchCalls.every((c) => !c.url.includes("inbox") && !c.url.startsWith(AARON_ORIGIN)),
      "unset inbox must not invent a webhook URL or proxy",
    );
    assert(fetchCalls.length === 0, "unset inbox must not POST anywhere");

    fetchCalls = [];
    const ore = await worker.fetch(
      new Request(`${ORIGIN}/joe/ore/rpc`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      }),
      env,
      ctx,
    );
    assert(ore.status === 401, `OAuth token must not unlock /joe/ore, got ${ore.status}`);
    assert(
      fetchCalls.every((c) => !c.url.startsWith(AARON_ORIGIN)),
      "OAuth token must not proxy ore",
    );

    fetchCalls = [];
    const joeStill = await worker.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${JOE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
      env,
      ctx,
    );
    assert(joeStill.status === 200, `JOE token still proxies, got ${joeStill.status}`);
    assert(
      fetchCalls.length === 1 && fetchCalls[0].url.startsWith(`${AARON_ORIGIN}/joe/hedgehog`),
      "computer JOE door unchanged",
    );

    const queryToken = await worker.fetch(
      new Request(`${MCP_URL}?token=${access}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      env,
      ctx,
    );
    assert(queryToken.status === 401, "OAuth token in the query string is rejected");
    const queryBody = await queryToken.text();
    assert(!queryBody.includes(access), "must not echo a query-string credential");
    assert(queryToken.status !== 301 && queryToken.status !== 302, "MCP porch must not 301");

    const leaked = "do-not-echo-this-query-secret";
    const queryKey = await worker.fetch(
      new Request(`${MCP_URL}?key=${leaked}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      env,
      ctx,
    );
    assert(queryKey.status === 401, "query-string key is rejected");
    const keyBody = await queryKey.text();
    assert(!keyBody.includes(leaked), "must not echo query-string key");
    assert((queryKey.headers.get("WWW-Authenticate") ?? "").includes("resource_metadata="), "OAuth challenge on query-key 401");

    const slash = await worker.fetch(
      new Request(`${MCP_URL}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
      env,
      ctx,
    );
    assert(slash.status === 401, `trailing slash is 401 not redirect, got ${slash.status}`);
    assert(!slash.headers.get("Location"), "no Location on /joe/hedgehog/");

    const cimdUrl = "https://oauth.example.test/supergrok-client.json";
    const cimdRedirect = "https://grok.com/oauth/callback";
    const { verifier: cimdVerifier, challenge: cimdChallenge } = await pkce();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url === cimdUrl) {
        return new Response(
          JSON.stringify({
            client_id: cimdUrl,
            client_name: "SuperGrok",
            redirect_uris: [cimdRedirect],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return previousFetch(input, init);
    }) as typeof fetch;
    const cimdAuth = new URL(`${ORIGIN}/oauth/authorize`);
    cimdAuth.searchParams.set("response_type", "code");
    cimdAuth.searchParams.set("client_id", cimdUrl);
    cimdAuth.searchParams.set("redirect_uri", cimdRedirect);
    cimdAuth.searchParams.set("code_challenge", cimdChallenge);
    cimdAuth.searchParams.set("code_challenge_method", "S256");
    cimdAuth.searchParams.set("resource", MCP_URL);
    const cimdConsent = await worker.fetch(new Request(cimdAuth.toString()), env, ctx);
    assert(cimdConsent.status === 200, `CIMD consent → 200, got ${cimdConsent.status}`);
    const cimdHtml = await cimdConsent.text();
    assert(cimdHtml.includes("SuperGrok"), "CIMD client_name on consent");
    const cimdFormCsrf = csrfFromHtml(cimdHtml);
    assertSignedCsrf(cimdFormCsrf);
    const cimdApproved = await worker.fetch(
      new Request(`${ORIGIN}/oauth/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          csrf_token: cimdFormCsrf,
          approve: "1",
          client_id: cimdUrl,
          redirect_uri: cimdRedirect,
          code_challenge: cimdChallenge,
          code_challenge_method: "S256",
          resource: MCP_URL,
          response_type: "code",
        }).toString(),
      }),
      env,
      ctx,
    );
    const cimdLoc = await assertApproveRedirectHtml(cimdApproved, cimdRedirect);
    const cimdCode = new URL(cimdLoc).searchParams.get("code");
    assert(cimdCode, "CIMD authorization code");
    const cimdToken = await worker.fetch(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: cimdCode,
          redirect_uri: cimdRedirect,
          client_id: cimdUrl,
          code_verifier: cimdVerifier,
          resource: MCP_URL,
        }).toString(),
      }),
      env,
      ctx,
    );
    assert(cimdToken.status === 200, `CIMD token → 200, got ${cimdToken.status}`);
    const cimdAccess = ((await cimdToken.json()) as { access_token?: string }).access_token;
    assert(cimdAccess, "CIMD access_token");
    const cimdList = await worker.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${cimdAccess}`, "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
      }),
      env,
      ctx,
    );
    const cimdTools = ((await cimdList.json()) as { result?: { tools?: Array<{ name: string }> } })
      .result?.tools ?? [];
    assert(cimdTools.length === 6, `CIMD tools/list → 6, got ${cimdTools.length}`);
    assert(cimdTools.some((t) => t.name === "message_joe"), "CIMD list includes message_joe");

    fetchCalls = [];
    const x402 = await worker.fetch(
      new Request(`${ORIGIN}/x402/v1/chat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: "{}",
      }),
      env,
      ctx,
    );
    // Edge proxies /x402/v1/* ungated; origin enforces payment. OAuth must not serve local MCP tools.
    assert(
      fetchCalls.some((c) => c.url.startsWith(`${AARON_ORIGIN}/x402/v1/chat`)),
      "OAuth token must not ungate x402 chat into local MCP; must proxy to origin",
    );
    const x402Body = await x402.text();
    assert(!x402Body.includes("message_joe"), "OAuth must not return MCP tools on x402 chat");

    const inboxUrl = "https://inbox.example.test/joe";
    const inboxEnv: GatewayEnv = {
      ...env,
      HEDGEHOG_INBOX_URL: inboxUrl,
      HEDGEHOG_INBOX_KEY: "inbox-test-key",
    };
    fetchCalls = [];
    const inboxPreviousFetch = globalThis.fetch;
    const inboxPosts: Array<{ url: string; method: string; body: string; auth: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = (
        init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET")
      ).toUpperCase();
      if (url.startsWith("https://inbox.example.test")) {
        const headerBag = init?.headers;
        const auth =
          headerBag instanceof Headers
            ? (headerBag.get("Authorization") ?? "")
            : headerBag && !Array.isArray(headerBag)
              ? String((headerBag as Record<string, string>).Authorization ?? "")
              : "";
        inboxPosts.push({
          url,
          method,
          body: typeof init?.body === "string" ? init.body : "",
          auth,
        });
        return new Response(null, { status: 204 });
      }
      return inboxPreviousFetch(input, init);
    }) as typeof fetch;
    const delivered = await worker.fetch(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 10,
          method: "tools/call",
          params: { name: "message_joe", arguments: { message: "wake joe" } },
        }),
      }),
      inboxEnv,
      ctx,
    );
    assert(delivered.status === 200, `message_joe with inbox → 200, got ${delivered.status}`);
    const deliveredBody = (await delivered.json()) as { result?: { content?: Array<{ text?: string }> } };
    const deliveredText = deliveredBody.result?.content?.[0]?.text ?? "";
    const deliveredAck = JSON.parse(deliveredText || "{}") as { woken?: boolean; delivered?: boolean };
    assert(
      deliveredAck.woken === true && deliveredAck.delivered === true,
      `inbox POST wakes Joe, posts=${inboxPosts.length} got ${deliveredText}`,
    );
    assert(inboxPosts.length === 1, `inbox POSTed once, got ${inboxPosts.length}`);
    assert(inboxPosts[0].method === "POST", "inbox method POST");
    assert(inboxPosts[0].body === "wake joe", "inbox body is the text only");
    assert(inboxPosts[0].auth === "Bearer inbox-test-key", "inbox uses secret key, not a mesh key");
    assert(
      fetchCalls.every((c) => !c.url.startsWith(AARON_ORIGIN)),
      "message_joe must not proxy to AARON",
    );
  } finally {
    restoreFetch();
  }
}

run()
  .then(() => {
    console.log("ok: SuperGrok OAuth tools/list returns 6 public tools including message_joe; /joe/ore and x402 stay gated");
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
