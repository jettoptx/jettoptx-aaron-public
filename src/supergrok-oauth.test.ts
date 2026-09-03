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

function cookieFrom(res: Response): string {
  const raw = res.headers.get("Set-Cookie") ?? "";
  const match = raw.match(/JOE_OAUTH_CSRF=([^;]+)/);
  return match ? `JOE_OAUTH_CSRF=${match[1]}` : "";
}

function assertCsrfCookieAttrs(res: Response, host: string): void {
  const raw = res.headers.get("Set-Cookie") ?? "";
  assert(raw.includes("JOE_OAUTH_CSRF="), `CSRF Set-Cookie, got ${raw}`);
  assert(raw.includes("Path=/"), "CSRF Path=/");
  assert(raw.includes("HttpOnly"), "CSRF HttpOnly");
  assert(raw.includes("SameSite=Lax"), "CSRF SameSite=Lax (consent POST is first-party)");
  assert(!/SameSite=Strict/i.test(raw), "CSRF must not be SameSite=Strict (dies on Google hop)");
  assert(!/Domain=\.jettoptics\.ai/i.test(raw), "CSRF must not use parent Domain=.jettoptics.ai");
  assert(!/Domain=jettoptics\.ai(;|$)/i.test(raw), "CSRF must not use parent Domain=jettoptics.ai");
  if (host === "mcp.jettoptics.ai") {
    assert(raw.includes("Domain=mcp.jettoptics.ai"), `CSRF Domain=mcp.jettoptics.ai, got ${raw}`);
    assert(raw.includes("Secure"), "HTTPS CSRF must be Secure");
  }
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
  const csrf = cookieFrom(consent);
  assert(csrf.length > 0, "CSRF cookie set");
  assertCsrfCookieAttrs(consent, "mcp.jettoptics.ai");

  const form = new URLSearchParams({
    csrf_token: csrf.split("=")[1],
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
  const approved = await worker.fetch(
    new Request(`${ORIGIN}/oauth/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrf },
      body: form.toString(),
    }),
    env,
    ctx,
  );
  assert(approved.status === 302, `approve → 302, got ${approved.status}`);
  const loc = approved.headers.get("Location") ?? "";
  assert(loc.startsWith(`${redirectUri}?`), `redirect to SuperGrok callback, got ${loc}`);
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
    const cimdCsrf = cookieFrom(cimdConsent);
    const cimdApproved = await worker.fetch(
      new Request(`${ORIGIN}/oauth/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cimdCsrf },
        body: new URLSearchParams({
          csrf_token: cimdCsrf.split("=")[1],
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
    assert(cimdApproved.status === 302, `CIMD approve → 302, got ${cimdApproved.status}`);
    const cimdLoc = cimdApproved.headers.get("Location") ?? "";
    assert(cimdLoc.startsWith(`${cimdRedirect}?`), "CIMD redirects to SuperGrok callback");
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
      new Request(`${ORIGIN}/x402/prima_title`, {
        method: "GET",
        headers: { Authorization: `Bearer ${access}` },
      }),
      env,
      ctx,
    );
    assert(x402.status === 402, `OAuth token must not ungate x402 prima_title, got ${x402.status}`);

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
