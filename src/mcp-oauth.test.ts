/**
 * SuperGrok MCP OAuth 2.1 on /joe/hedgehog:
 *   unauth 401 + WWW-Authenticate
 *   protected-resource + authorization-server metadata 200
 *   DCR + PKCE + JOE-gated authorize → access token → tools/list
 *   Bearer JOE token still proxies (stdio/computer)
 *   no Helius / x402 ungating; agent-card still origin
 *
 * Run: npm test
 */
import worker from "./index";
import { isAaronPath, isJoeHedgehogPath, isJoeOrePath } from "./aaron-gateway";
import { MCP_TOOLS } from "./data/augment-registry";
import type { GatewayEnv } from "./lib/cors";
import {
  buildWwwAuthenticate,
  isMcpOAuthDiscoveryPath,
  isMcpOAuthProtocolPath,
  joeHedgehogResource,
} from "./lib/mcp-oauth";
import { FAUCET_PAY_TO, PRIMA_PAY_TO } from "./x402-prima-title";

const AARON_ORIGIN = "https://aaron.example.test";
const HEDGEHOG_ORIGIN = "https://hedgehog.example.test";
const JOE_TOKEN = "test-joe-token";

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
    if (url.includes("helius") || url.includes("mainnet-beta") || url.includes("api-key=")) {
      throw new Error(`OAuth porch must not call Helius or keyed RPC, got ${url}`);
    }
    if (url.startsWith(AARON_ORIGIN) || url.startsWith(HEDGEHOG_ORIGIN)) {
      fetchCalls.push({ url, method });
      return new Response(JSON.stringify({ source: "aaron-origin", ok: true }), {
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
  if (!cond) throw new Error(msg);
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

async function run(): Promise<void> {
  assert(isMcpOAuthDiscoveryPath("/.well-known/oauth-protected-resource") === true, "root PR metadata");
  assert(
    isMcpOAuthDiscoveryPath("/.well-known/oauth-protected-resource/joe/hedgehog") === true,
    "path-specific PR metadata",
  );
  assert(isMcpOAuthDiscoveryPath("/.well-known/oauth-authorization-server") === true, "AS metadata");
  assert(isMcpOAuthDiscoveryPath("/.well-known/agent-card.json") === false, "must not swallow agent-card");
  assert(isMcpOAuthProtocolPath("/authorize") === true, "/authorize is the MCP OAuth door");
  assert(isMcpOAuthProtocolPath("/oauth/token") === true, "/oauth/token is the MCP OAuth door");
  assert(isMcpOAuthProtocolPath("/oauth/register") === true, "/oauth/register is DCR");
  assert(isJoeHedgehogPath("/joe/hedgehog") === true, "porch path unchanged");
  assert(isAaronPath("/authorize") === false, "OAuth authorize is not AARON_PATHS");
  assert(isAaronPath("/.well-known/oauth-protected-resource") === false, "OAuth metadata is not AARON_PATHS");
  assert(isAaronPath("/.well-known/agent-card.json") === true, "agent-card stays Aaron");
  assert(isJoeOrePath("/joe/ore/rpc") === true, "ORE porch still listed");

  const porch = new URL("https://mcp.jettoptics.ai/joe/hedgehog");
  assert(
    joeHedgehogResource(porch) === "https://mcp.jettoptics.ai/joe/hedgehog",
    "canonical SuperGrok resource",
  );
  assert(
    buildWwwAuthenticate(porch).includes("/.well-known/oauth-protected-resource/joe/hedgehog"),
    "WWW-Authenticate points at path-specific metadata",
  );

  installFetchMock();
  try {
    const pr = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/.well-known/oauth-protected-resource"),
      env,
      ctx,
    );
    assert(pr.status === 200, `PR metadata → 200, got ${pr.status}`);
    const prBody = (await pr.json()) as {
      resource?: string;
      authorization_servers?: string[];
      bearer_methods_supported?: string[];
    };
    assert(prBody.resource === "https://mcp.jettoptics.ai/joe/hedgehog", `resource ${prBody.resource}`);
    assert(
      prBody.authorization_servers?.[0] === "https://mcp.jettoptics.ai",
      "authorization_servers lists this Worker",
    );
    assert(prBody.bearer_methods_supported?.includes("header") === true, "header bearer method");
    assert(fetchCalls.length === 0, "PR metadata must not proxy");

    const prPath = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/.well-known/oauth-protected-resource/joe/hedgehog"),
      env,
      ctx,
    );
    assert(prPath.status === 200, `path-specific PR metadata → 200, got ${prPath.status}`);
    const prPathBody = (await prPath.json()) as { resource?: string };
    assert(prPathBody.resource === "https://mcp.jettoptics.ai/joe/hedgehog", "path-specific resource is hedgehog");

    const asMeta = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/.well-known/oauth-authorization-server"),
      env,
      ctx,
    );
    assert(asMeta.status === 200, `AS metadata → 200, got ${asMeta.status}`);
    const asBody = (await asMeta.json()) as {
      issuer?: string;
      authorization_endpoint?: string;
      token_endpoint?: string;
      registration_endpoint?: string;
      code_challenge_methods_supported?: string[];
    };
    assert(asBody.issuer === "https://mcp.jettoptics.ai", `issuer ${asBody.issuer}`);
    assert(asBody.authorization_endpoint === "https://mcp.jettoptics.ai/authorize", "authorize endpoint");
    assert(asBody.token_endpoint === "https://mcp.jettoptics.ai/oauth/token", "token endpoint");
    assert(asBody.registration_endpoint === "https://mcp.jettoptics.ai/oauth/register", "DCR endpoint");
    assert(asBody.code_challenge_methods_supported?.includes("S256") === true, "PKCE S256");

    const agentCard = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/.well-known/agent-card.json"),
      env,
      ctx,
    );
    assert(agentCard.status === 200, "agent-card still proxied, not overwritten");
    assert(
      fetchCalls.some((c) => c.url.startsWith(`${AARON_ORIGIN}/.well-known/agent-card.json`)),
      "agent-card still goes to origin",
    );

    fetchCalls = [];
    const ore = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore/rpc", { method: "POST" }),
      env,
      ctx,
    );
    assert(ore.status === 401, `unauth /joe/ore/rpc stays 401, got ${ore.status}`);
    assert(fetchCalls.length === 0, "OAuth work must not ungate /joe/ore");

    fetchCalls = [];
    const catalog = await worker.fetch(new Request("https://mcp.jettoptics.ai/x402"), env, ctx);
    assert(catalog.status === 200, `GET /x402 still catalog, got ${catalog.status}`);
    const catalogBody = (await catalog.json()) as { payTo?: string; services?: Array<{ id?: string; payTo?: string }> };
    assert(catalogBody.payTo === FAUCET_PAY_TO, "catalog top-level payTo stays 5ct4");
    const prima = catalogBody.services?.find((s) => s.id === "prima_title");
    assert(prima?.payTo === PRIMA_PAY_TO, "prima_title payTo stays GtAk");

    fetchCalls = [];
    const unauthTools = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/hedgehog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      env,
      ctx,
    );
    assert(unauthTools.status === 401, `unauth tools/list → 401, got ${unauthTools.status}`);
    assert(unauthTools.status !== 404, "unauth tools/list must never 404");
    const www = unauthTools.headers.get("WWW-Authenticate") ?? "";
    assert(www.includes('resource_metadata="https://mcp.jettoptics.ai/.well-known/oauth-protected-resource/joe/hedgehog"'), www);
    const unauthBody = (await unauthTools.json()) as { result?: { tools?: unknown[] } };
    assert(!unauthBody.result?.tools, "unauth must never return public tools");
    assert(fetchCalls.length === 0, "unauth tools/list must not proxy");

    fetchCalls = [];
    const joeStill = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/hedgehog", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${JOE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      env,
      ctx,
    );
    assert(joeStill.status === 200, `Bearer JOE still works, got ${joeStill.status}`);
    assert(
      fetchCalls.length === 1 && fetchCalls[0].url.startsWith(`${AARON_ORIGIN}/joe/hedgehog`),
      "Bearer JOE still proxies to AARON_ORIGIN (stdio/computer)",
    );

    const dcr = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/oauth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "SuperGrok",
          redirect_uris: ["http://127.0.0.1:8788/callback"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code"],
          response_types: ["code"],
        }),
      }),
      env,
      ctx,
    );
    assert(dcr.status === 201, `DCR → 201, got ${dcr.status}`);
    const dcrBody = (await dcr.json()) as { client_id?: string };
    assert(typeof dcrBody.client_id === "string" && dcrBody.client_id.includes("."), "signed client_id");

    const { verifier, challenge } = await pkce();
    const authorize = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: dcrBody.client_id,
          redirect_uri: "http://127.0.0.1:8788/callback",
          response_type: "code",
          state: "st1",
          code_challenge: challenge,
          code_challenge_method: "S256",
          resource: "https://mcp.jettoptics.ai/joe/hedgehog",
          joe_token: JOE_TOKEN,
        }).toString(),
      }),
      env,
      ctx,
    );
    assert(authorize.status === 302, `authorize with JOE token → 302, got ${authorize.status}`);
    const location = authorize.headers.get("Location") ?? "";
    const redirected = new URL(location);
    const code = redirected.searchParams.get("code");
    assert(code, `authorize redirect must include code, got ${location}`);
    assert(redirected.searchParams.get("iss") === "https://mcp.jettoptics.ai", "RFC 9207 iss");

    const tokenRes = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: "http://127.0.0.1:8788/callback",
          client_id: dcrBody.client_id,
          code_verifier: verifier,
          resource: "https://mcp.jettoptics.ai/joe/hedgehog",
        }).toString(),
      }),
      env,
      ctx,
    );
    assert(tokenRes.status === 200, `token → 200, got ${tokenRes.status}`);
    const tokenBody = (await tokenRes.json()) as { access_token?: string; token_type?: string };
    assert(tokenBody.token_type === "Bearer", "token_type Bearer");
    assert(typeof tokenBody.access_token === "string" && tokenBody.access_token.length > 10, "access_token issued");

    fetchCalls = [];
    const tools = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/hedgehog", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenBody.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
      }),
      env,
      ctx,
    );
    assert(tools.status === 200, `OAuth tools/list → 200, got ${tools.status}`);
    const toolsBody = (await tools.json()) as { result?: { tools?: Array<{ name?: string }> } };
    const names = (toolsBody.result?.tools ?? []).map((t) => t.name);
    const expected = MCP_TOOLS.map((t) => t.name);
    assert(names.join(",") === expected.join(","), `HEDGEHOG tools ${names.join(",")}`);
    for (const name of [
      "hedgehog_health",
      "jett_augment_status",
      "jett_docs_search",
      "jett_augment_lookup",
      "jett_edge_diagnose",
    ]) {
      assert(names.includes(name), `missing tool ${name}`);
    }
    assert(fetchCalls.length === 0, "OAuth tools/list must use local HEDGEHOG handlers, not AARON_ORIGIN");

    fetchCalls = [];
    const init = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/mcp", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${JOE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      env,
      ctx,
    );
    const mcpTools = ((await init.json()) as { result?: { tools?: Array<{ name?: string }> } }).result?.tools ?? [];
    assert(
      mcpTools.map((t) => t.name).join(",") === names.join(","),
      "OAuth /joe/hedgehog tools/list matches authenticated POST /mcp",
    );
  } finally {
    restoreFetch();
  }
}

run()
  .then(() => {
    console.log(
      "ok: SuperGrok MCP OAuth on /joe/hedgehog — 401+WWW-Authenticate, metadata 200, tools/list after token; JOE Bearer still proxies; no Helius/x402 ungating",
    );
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
