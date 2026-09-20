/**
 * Proves /stdb and /agt are AARON_PATHS (exact + prefix) and proxyToAaron
 * to AARON_ORIGIN. They must not Worker-404, must not Worker-first to
 * SPACETIME_HTTP_URL, and must not attach CF Access service tokens.
 * Existing AARON_PATHS doors stay origin-proxied.
 *
 * Run: npm test
 */
import worker from "./index";
import { isAaronPath, isJoeHedgehogPath, isJoeMcpPath, isJoeOrePath } from "./aaron-gateway";
import { isHedgehogPath } from "./hedgehog-mcp";
import { isOriginMutatorKillSwitchPath } from "./origin-mutator-kill-switch";
import type { GatewayEnv } from "./lib/cors";

const AARON_ORIGIN = "https://aaron.example.test";
const HEDGEHOG_ORIGIN = "https://hedgehog.example.test";
const STDB_HTTP = "https://stdb.jettoptics.ai/v1/database/jettchat";
const JOE_TOKEN = "test-joe-token";
const ACCESS_ID = "test-access-client-id";
const ACCESS_SECRET = "test-access-client-secret";

const env: GatewayEnv = {
  AARON_ORIGIN,
  HEDGEHOG_ORIGIN,
  ENV: "test",
  MCP_API_KEY: JOE_TOKEN,
  SPACETIME_HTTP_URL: STDB_HTTP,
  CF_ACCESS_CLIENT_ID: ACCESS_ID,
  CF_ACCESS_CLIENT_SECRET: ACCESS_SECRET,
};

const ctx = {} as ExecutionContext;

type FetchCall = { url: string; method: string; headers: Record<string, string> };
let fetchCalls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

function headerRecord(headers?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  const h = new Headers(headers);
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

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
    const headers = headerRecord(
      init?.headers ?? (typeof input !== "string" && !(input instanceof URL) ? input.headers : undefined),
    );
    fetchCalls.push({ url, method, headers });
    if (url.includes("stdb.jettoptics.ai") || url.startsWith(STDB_HTTP)) {
      throw new Error(`Worker must not Worker-first /stdb|/agt to SpacetimeDB, got ${url}`);
    }
    if (url.startsWith(AARON_ORIGIN) || url.startsWith(HEDGEHOG_ORIGIN)) {
      return new Response(JSON.stringify({ source: "aaron-origin", ok: true, path: new URL(url).pathname }), {
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

function isExactAaronPath(url: string, path: string): boolean {
  return url === `${AARON_ORIGIN}${path}` || url.startsWith(`${AARON_ORIGIN}${path}?`);
}

function assertNoAccessHeaders(call: FetchCall, label: string): void {
  assert(!call.headers["cf-access-client-id"], `${label} must not attach CF-Access-Client-Id`);
  assert(!call.headers["cf-access-client-secret"], `${label} must not attach CF-Access-Client-Secret`);
}

async function assertProxied(
  path: string,
  method: string,
  extraHeaders?: Record<string, string>,
  body?: string,
): Promise<void> {
  fetchCalls = [];
  const res = await worker.fetch(
    new Request(`https://mcp.jettoptics.ai${path}`, {
      method,
      headers: extraHeaders,
      body,
    }),
    env,
    ctx,
  );
  assert(res.status === 200, `${method} ${path} → 200, got ${res.status}`);
  assert(res.status !== 404, `${method} ${path} must not Worker-404`);
  assert(fetchCalls.length === 1, `${method} ${path} proxies once, got ${fetchCalls.length}`);
  assert(
    isExactAaronPath(fetchCalls[0].url, path),
    `${method} ${path} proxies to AARON_ORIGIN${path}, got ${fetchCalls[0].url}`,
  );
  assert(fetchCalls[0].method === method, `${method} is forwarded, got ${fetchCalls[0].method}`);
  assert(!fetchCalls[0].url.includes("stdb."), `${path} must not call SpacetimeDB`);
  assert(!fetchCalls[0].url.startsWith(HEDGEHOG_ORIGIN), `${path} must not proxy to HEDGEHOG_ORIGIN`);
  assertNoAccessHeaders(fetchCalls[0], `${method} ${path}`);
}

async function run(): Promise<void> {
  assert(isAaronPath("/stdb") === true, "exact /stdb is an AARON_PATH");
  assert(isAaronPath("/stdb/") === true, "prefix /stdb/ is an AARON_PATH");
  assert(isAaronPath("/stdb/sql") === true, "prefix /stdb/sql is an AARON_PATH");
  assert(isAaronPath("/stdb/v1/database/jettchat") === true, "prefix /stdb/v1… is an AARON_PATH");
  assert(isAaronPath("/agt") === true, "exact /agt is an AARON_PATH");
  assert(isAaronPath("/agt/") === true, "prefix /agt/ is an AARON_PATH");
  assert(isAaronPath("/agt/status") === true, "prefix /agt/status is an AARON_PATH");
  assert(isAaronPath("/stdbfoo") === false, "/stdbfoo is not a prefix match");
  assert(isAaronPath("/agtfoo") === false, "/agtfoo is not a prefix match");
  assert(isAaronPath("/std") === false, "/std is not /stdb");
  assert(isAaronPath("/ag") === false, "/ag is not /agt");

  assert(isHedgehogPath("/stdb") === false, "/stdb is not hedgehog");
  assert(isHedgehogPath("/agt") === false, "/agt is not hedgehog");
  assert(isJoeHedgehogPath("/stdb") === false, "/stdb is not /joe/hedgehog");
  assert(isJoeMcpPath("/agt") === false, "/agt is not /joe/mcp");
  assert(isJoeOrePath("/stdb") === false, "/stdb is not the ORE porch");
  assert(isOriginMutatorKillSwitchPath("/stdb") === false, "/stdb is not a leftover-mutator kill path");
  assert(isOriginMutatorKillSwitchPath("/agt") === false, "/agt is not a leftover-mutator kill path");

  for (const path of [
    "/session",
    "/verify",
    "/gaze",
    "/mint",
    "/handshake",
    "/x402",
    "/orphan",
    "/.well-known/agent-card.json",
  ]) {
    assert(isAaronPath(path) === true, `${path} stays an AARON_PATH`);
  }

  installFetchMock();
  try {
    await assertProxied("/stdb", "GET");
    await assertProxied("/stdb/", "GET");
    await assertProxied("/stdb/sql", "POST", { "Content-Type": "text/plain" }, "SELECT 1");
    await assertProxied("/agt", "GET");
    await assertProxied("/agt/", "GET");
    await assertProxied("/agt/status", "POST", { "Content-Type": "application/json" }, "{}");

    fetchCalls = [];
    const unknown = await worker.fetch(new Request("https://mcp.jettoptics.ai/stdbfoo", { method: "GET" }), env, ctx);
    assert(unknown.status === 404, `/stdbfoo stays Worker 404, got ${unknown.status}`);
    const unknownBody = (await unknown.json()) as { error?: string; hint?: string };
    assert(unknownBody.error === "Not found", "/stdbfoo is not an Aaron door");
    assert(unknownBody.hint?.includes("/stdb") === true, "404 hint lists /stdb");
    assert(unknownBody.hint?.includes("/agt") === true, "404 hint lists /agt");
    assert(fetchCalls.length === 0, "/stdbfoo must not proxy");

    fetchCalls = [];
    const agtFoo = await worker.fetch(new Request("https://mcp.jettoptics.ai/agtfoo", { method: "GET" }), env, ctx);
    assert(agtFoo.status === 404, `/agtfoo stays Worker 404, got ${agtFoo.status}`);
    assert(fetchCalls.length === 0, "/agtfoo must not proxy");

    await assertProxied("/session", "GET");
    await assertProxied("/verify", "GET");
    await assertProxied("/gaze", "GET");
    await assertProxied("/mint", "GET");
    await assertProxied("/handshake", "GET");
    await assertProxied("/x402/v1/chat", "POST", { "Content-Type": "application/json" }, "{}");
    await assertProxied("/orphan/402", "GET");
    await assertProxied("/.well-known/agent-card.json", "GET");

    fetchCalls = [];
    const catalog = await worker.fetch(new Request("https://mcp.jettoptics.ai/x402", { method: "GET" }), env, ctx);
    assert(catalog.status === 200, `GET /x402 catalog still 200, got ${catalog.status}`);
    assert(fetchCalls.length === 0, "GET /x402 catalog must not proxy");

    fetchCalls = [];
    const gazeAnalyze = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/gaze/analyze", { method: "POST" }),
      env,
      ctx,
    );
    assert(gazeAnalyze.status === 401, `/gaze/analyze kill-switch still 401, got ${gazeAnalyze.status}`);
    assert(fetchCalls.length === 0, "/gaze/analyze must not proxy");
  } finally {
    restoreFetch();
  }
}

run()
  .then(() => {
    console.log(
      "ok: /stdb and /agt are AARON_PATHS proxied to AARON_ORIGIN; no Worker-first STDB; existing Aaron doors unchanged",
    );
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
