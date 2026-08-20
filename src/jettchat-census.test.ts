/**
 * Proves GET /mcp/jettchat is JOE-gated and proxied to AARON_ORIGIN,
 * and that POST /mcp stays on the HEDGEHOG handler (not AARON_PATHS).
 *
 * Run: npm test
 */
import worker from "./index";
import { isAaronPath } from "./aaron-gateway";
import { isHedgehogPath, isJettchatCensusPath } from "./hedgehog-mcp";
import type { GatewayEnv } from "./lib/cors";

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
    const method = (init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET")).toUpperCase();
    if (url.startsWith(AARON_ORIGIN) || url.startsWith(HEDGEHOG_ORIGIN)) {
      fetchCalls.push({ url, method });
      return new Response(JSON.stringify({ source: "aaron-census", ok: true }), {
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

async function run(): Promise<void> {
  assert(isJettchatCensusPath("/mcp/jettchat") === true, "exact /mcp/jettchat is the census path");
  assert(isJettchatCensusPath("/mcp/jettchat/") === false, "trailing slash is not the census path");
  assert(isJettchatCensusPath("/mcp/jettchat/extra") === false, "prefix /mcp/jettchat/ is not the census path");
  assert(isJettchatCensusPath("/mcp") === false, "/mcp is not the census path");

  assert(isHedgehogPath("/mcp") === true, "POST /mcp stays hedgehog");
  assert(isHedgehogPath("/mcp/jettchat") === true, "isHedgehogPath would swallow /mcp/jettchat if checked first");
  assert(isAaronPath("/mcp/jettchat") === false, "/mcp/jettchat is not in AARON_PATHS");
  assert(isAaronPath("/session") === true, "/session remains an ungated Aaron path");

  installFetchMock();
  try {
    const missing = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/mcp/jettchat", { method: "GET" }),
      env,
      ctx,
    );
    assert(missing.status === 401, `missing token → 401, got ${missing.status}`);
    assert(fetchCalls.length === 0, "missing token must not proxy or count");

    const wrong = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/mcp/jettchat", {
        method: "GET",
        headers: { "X-JOE-Token": "wrong-token" },
      }),
      env,
      ctx,
    );
    assert(wrong.status === 401, `wrong token → 401, got ${wrong.status}`);
    assert(fetchCalls.length === 0, "wrong token must not proxy or count");

    const ok = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/mcp/jettchat", {
        method: "GET",
        headers: { Authorization: `Bearer ${JOE_TOKEN}` },
      }),
      env,
      ctx,
    );
    assert(ok.status === 200, `valid JOE token → proxy 200, got ${ok.status}`);
    assert(fetchCalls.length === 1, `valid token proxies once, got ${fetchCalls.length}`);
    assert(
      fetchCalls[0].url.startsWith(`${AARON_ORIGIN}/mcp/jettchat`),
      `proxied to AARON_ORIGIN /mcp/jettchat, got ${fetchCalls[0].url}`,
    );
    assert(!fetchCalls[0].url.includes("3000"), "must not hit Jetson :3000");
    assert(!fetchCalls[0].url.includes("stdb."), "census path must not call SpacetimeDB");

    fetchCalls = [];
    const headerOk = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/mcp/jettchat", {
        method: "GET",
        headers: { "X-JOE-Token": JOE_TOKEN },
      }),
      env,
      ctx,
    );
    assert(headerOk.status === 200, `X-JOE-Token → proxy 200, got ${headerOk.status}`);
    assert(
      fetchCalls.length === 1 && fetchCalls[0].url.startsWith(`${AARON_ORIGIN}/mcp/jettchat`),
      "X-JOE-Token also proxies to AARON_ORIGIN",
    );

    fetchCalls = [];
    const nested = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/mcp/jettchat/extra", {
        method: "GET",
        headers: { Authorization: `Bearer ${JOE_TOKEN}` },
      }),
      env,
      ctx,
    );
    assert(nested.status === 404, `GET /mcp/jettchat/extra stays hedgehog 404, got ${nested.status}`);
    assert(fetchCalls.length === 0, "nested /mcp/jettchat/ must not proxy to Aaron");

    fetchCalls = [];
    const mcpPost = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/mcp", {
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
    assert(mcpPost.status === 200, `POST /mcp stays hedgehog 200, got ${mcpPost.status}`);
    const mcpBody = (await mcpPost.json()) as { result?: { serverInfo?: { name?: string } } };
    assert(
      mcpBody.result?.serverInfo?.name === "jettoptx-aaron-hedgehog",
      "POST /mcp is still the hedgehog MCP initialize handler",
    );
    assert(fetchCalls.length === 0, "POST /mcp must not proxy to AARON_ORIGIN");
  } finally {
    restoreFetch();
  }
}

run()
  .then(() => {
    console.log("ok: GET /mcp/jettchat is JOE-gated and proxied; POST /mcp is still hedgehog");
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
