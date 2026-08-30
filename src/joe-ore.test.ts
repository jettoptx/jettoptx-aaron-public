/**
 * Proves GET/POST /joe/ore is JOE-gated and proxied to AARON_ORIGIN,
 * not AARON_PATHS, not Hedgehog :8811, not a public Helius/RPC proxy,
 * and not swallowed as /mcp/*. Unauth GET/POST must be 401 (never 404).
 * Helius/gRPC subscribe stays on joe-aaron-router (origin).
 *
 * Run: npm test
 */
import worker from "./index";
import { isAaronPath, isJoeHedgehogPath, isJoeMcpPath, isJoeOrePath } from "./aaron-gateway";
import { isHedgehogPath, isJettchatCensusPath } from "./hedgehog-mcp";
import type { GatewayEnv } from "./lib/cors";

const AARON_ORIGIN = "https://aaron.example.test";
const HEDGEHOG_ORIGIN = "https://hedgehog.example.test";
const JOE_TOKEN = "test-joe-token";
const ORE_PROGRAM = "oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv";

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
    if (url.includes("helius") || url.includes("api-key") || url.includes("mainnet-beta")) {
      throw new Error(`Worker must not call Helius or public RPC from /joe/ore, got ${url}`);
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
  if (!cond) {
    throw new Error(msg);
  }
}

async function run(): Promise<void> {
  assert(isJoeOrePath("/joe/ore") === true, "exact /joe/ore is the ORE/AgenC porch");
  assert(isJoeOrePath("/joe/ore/") === true, "optional trailing slash is the ORE porch");
  assert(isJoeOrePath("/joe/ore/sse") === true, "/joe/ore/sse is the SSE sibling");
  assert(isJoeOrePath("/joe/ore/sse/") === true, "optional trailing slash on SSE sibling");
  assert(isJoeOrePath("/joe/mcp") === false, "/joe/mcp is a separate Joe MCP door");
  assert(isJoeOrePath("/joe/hedgehog") === false, "/joe/hedgehog is a separate door");
  assert(isJoeOrePath("/mcp") === false, "/mcp is not the ORE porch");
  assert(isJoeOrePath("/mcp/jettchat") === false, "census path is not the ORE porch");
  assert(isJoeOrePath("/joe/ore/extra") === false, "prefix /joe/ore/extra is not this door");

  assert(isJoeHedgehogPath("/joe/ore") === false, "/joe/ore is not the Joe/hedgehog matcher");
  assert(isJoeMcpPath("/joe/ore") === false, "/joe/ore is not the /joe/mcp matcher");
  assert(isHedgehogPath("/joe/ore") === false, "/joe/ore is not swallowed as /mcp/*");
  assert(isHedgehogPath("/mcp") === true, "POST /mcp stays hedgehog");
  assert(isAaronPath("/joe/ore") === false, "/joe/ore is not in AARON_PATHS");
  assert(isAaronPath("/joe/ore/") === false, "/joe/ore/ is not in AARON_PATHS");
  assert(isAaronPath("/joe/ore/sse") === false, "/joe/ore/sse is not in AARON_PATHS");
  assert(isAaronPath("/session") === true, "/session remains an ungated Aaron path");
  assert(isAaronPath("/.well-known/agent-card.json") === true, "agent-card stays an Aaron path");

  assert(isJettchatCensusPath("/mcp/jettchat") === true, "GET /mcp/jettchat is still the census special case");
  assert(isJettchatCensusPath("/joe/ore") === false, "ORE porch is not the census path");

  installFetchMock();
  try {
    const missingGet = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore", { method: "GET" }),
      env,
      ctx,
    );
    assert(missingGet.status === 401, `unauth GET → 401, got ${missingGet.status}`);
    assert(missingGet.status !== 404, "unauth GET must never 404");
    assert(fetchCalls.length === 0, "unauth GET must not proxy or count");

    const missingPost = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore", { method: "POST" }),
      env,
      ctx,
    );
    assert(missingPost.status === 401, `unauth POST → 401, got ${missingPost.status}`);
    assert(missingPost.status !== 404, "unauth POST must never 404");
    assert(fetchCalls.length === 0, "unauth POST must not proxy or count");

    const queryToken = await worker.fetch(
      new Request(`https://mcp.jettoptics.ai/joe/ore?token=${JOE_TOKEN}`, { method: "GET" }),
      env,
      ctx,
    );
    assert(queryToken.status === 401, `token in URL → 401, got ${queryToken.status}`);
    assert(fetchCalls.length === 0, "query-string token must not proxy");

    const wrong = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore", {
        method: "POST",
        headers: { "X-JOE-Token": "wrong-token" },
      }),
      env,
      ctx,
    );
    assert(wrong.status === 401, `wrong token → 401, got ${wrong.status}`);
    assert(fetchCalls.length === 0, "wrong token must not proxy or count");

    const ok = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${JOE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ program: ORE_PROGRAM, method: "subscribe" }),
      }),
      env,
      ctx,
    );
    assert(ok.status === 200, `valid Bearer → proxy 200, got ${ok.status}`);
    assert(fetchCalls.length === 1, `valid token proxies once, got ${fetchCalls.length}`);
    assert(
      fetchCalls[0].url.startsWith(`${AARON_ORIGIN}/joe/ore`),
      `proxied to AARON_ORIGIN /joe/ore, got ${fetchCalls[0].url}`,
    );
    assert(fetchCalls[0].method === "POST", `POST is forwarded, got ${fetchCalls[0].method}`);
    assert(!fetchCalls[0].url.includes("8811"), "must not proxy to Hedgehog :8811");
    assert(!fetchCalls[0].url.startsWith(HEDGEHOG_ORIGIN), "must not proxy to HEDGEHOG_ORIGIN");
    assert(!fetchCalls[0].url.includes("stdb."), "ORE porch must not call SpacetimeDB");
    assert(!fetchCalls[0].url.includes("helius"), "must not proxy to Helius from the Worker");
    assert(!fetchCalls[0].url.includes("api-key"), "must not put an api-key on the proxy URL");
    assert(!fetchCalls[0].url.includes("/joe/mcp"), "ORE porch must not rewrite to /joe/mcp");
    assert(!fetchCalls[0].url.includes("/joe/hedgehog"), "ORE porch must not rewrite to /joe/hedgehog");

    fetchCalls = [];
    const headerOk = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore", {
        method: "GET",
        headers: { "X-JOE-Token": JOE_TOKEN },
      }),
      env,
      ctx,
    );
    assert(headerOk.status === 200, `X-JOE-Token GET → proxy 200, got ${headerOk.status}`);
    assert(
      fetchCalls.length === 1 && fetchCalls[0].url.startsWith(`${AARON_ORIGIN}/joe/ore`),
      "X-JOE-Token also proxies to AARON_ORIGIN /joe/ore",
    );
    assert(!fetchCalls[0].url.includes("helius"), "authenticated GET must not hit Helius");

    fetchCalls = [];
    const sseOk = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore/sse", {
        method: "GET",
        headers: { Authorization: `Bearer ${JOE_TOKEN}` },
      }),
      env,
      ctx,
    );
    assert(sseOk.status === 200, `GET /joe/ore/sse → proxy 200, got ${sseOk.status}`);
    assert(
      fetchCalls.length === 1 && fetchCalls[0].url.startsWith(`${AARON_ORIGIN}/joe/ore/sse`),
      `SSE sibling proxies to AARON_ORIGIN /joe/ore/sse, got ${fetchCalls[0]?.url}`,
    );

    fetchCalls = [];
    const census = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/mcp/jettchat", {
        method: "GET",
        headers: { Authorization: `Bearer ${JOE_TOKEN}` },
      }),
      env,
      ctx,
    );
    assert(census.status === 200, `GET /mcp/jettchat still census 200, got ${census.status}`);
    assert(
      fetchCalls.length === 1 && fetchCalls[0].url.startsWith(`${AARON_ORIGIN}/mcp/jettchat`),
      "GET /mcp/jettchat is still the census special case to AARON_ORIGIN",
    );

    fetchCalls = [];
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
    console.log(
      "ok: /joe/ore is JOE-gated and proxied to AARON_ORIGIN; unauth GET/POST are 401; no Helius on Worker",
    );
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
