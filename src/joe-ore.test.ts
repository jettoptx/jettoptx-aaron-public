/**
 * Proves live ORE porch paths match origin joe-aaron-router:
 *   POST/GET /joe/ore/rpc
 *   GET /joe/ore/subscribe
 * JOE-gated, proxied to AARON_ORIGIN with the original path.
 * Not AARON_PATHS, not Hedgehog :8811, not a public Helius/RPC proxy.
 * Unauth GET/POST must be 401 (never 404). Explicit list — /joe/ore/extra is not this door.
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

function isExactAaronOrePath(url: string, path: string): boolean {
  return url === `${AARON_ORIGIN}${path}` || url.startsWith(`${AARON_ORIGIN}${path}?`);
}

async function run(): Promise<void> {
  assert(isJoeOrePath("/joe/ore") === true, "exact /joe/ore stays on the porch list");
  assert(isJoeOrePath("/joe/ore/") === true, "optional trailing slash is the ORE porch");
  assert(isJoeOrePath("/joe/ore/rpc") === true, "/joe/ore/rpc is the live origin RPC door");
  assert(isJoeOrePath("/joe/ore/rpc/") === true, "optional trailing slash on /joe/ore/rpc");
  assert(isJoeOrePath("/joe/ore/subscribe") === true, "/joe/ore/subscribe is the live origin SSE door");
  assert(isJoeOrePath("/joe/ore/subscribe/") === true, "optional trailing slash on /joe/ore/subscribe");
  assert(isJoeOrePath("/joe/ore/sse") === true, "/joe/ore/sse is kept as an SSE sibling");
  assert(isJoeOrePath("/joe/ore/sse/") === true, "optional trailing slash on SSE sibling");
  assert(isJoeOrePath("/joe/mcp") === false, "/joe/mcp is a separate Joe MCP door");
  assert(isJoeOrePath("/joe/hedgehog") === false, "/joe/hedgehog is a separate door");
  assert(isJoeOrePath("/mcp") === false, "/mcp is not the ORE porch");
  assert(isJoeOrePath("/mcp/jettchat") === false, "census path is not the ORE porch");
  assert(isJoeOrePath("/joe/ore/extra") === false, "prefix /joe/ore/extra is not this door");

  assert(isJoeHedgehogPath("/joe/ore") === false, "/joe/ore is not the Joe/hedgehog matcher");
  assert(isJoeMcpPath("/joe/ore") === false, "/joe/ore is not the /joe/mcp matcher");
  assert(isHedgehogPath("/joe/ore") === false, "/joe/ore is not swallowed as /mcp/*");
  assert(isHedgehogPath("/joe/ore/rpc") === false, "/joe/ore/rpc is not swallowed as /mcp/*");
  assert(isHedgehogPath("/mcp") === true, "POST /mcp stays hedgehog");
  assert(isAaronPath("/joe/ore") === false, "/joe/ore is not in AARON_PATHS");
  assert(isAaronPath("/joe/ore/") === false, "/joe/ore/ is not in AARON_PATHS");
  assert(isAaronPath("/joe/ore/rpc") === false, "/joe/ore/rpc is not in AARON_PATHS");
  assert(isAaronPath("/joe/ore/subscribe") === false, "/joe/ore/subscribe is not in AARON_PATHS");
  assert(isAaronPath("/joe/ore/sse") === false, "/joe/ore/sse is not in AARON_PATHS");
  assert(isAaronPath("/session") === true, "/session remains an ungated Aaron path");
  assert(isAaronPath("/.well-known/agent-card.json") === true, "agent-card stays an Aaron path");

  assert(isJettchatCensusPath("/mcp/jettchat") === true, "GET /mcp/jettchat is still the census special case");
  assert(isJettchatCensusPath("/joe/ore") === false, "ORE porch is not the census path");

  installFetchMock();
  try {
    const missingRpcGet = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore/rpc", { method: "GET" }),
      env,
      ctx,
    );
    assert(missingRpcGet.status === 401, `unauth GET /joe/ore/rpc → 401, got ${missingRpcGet.status}`);
    assert(missingRpcGet.status !== 404, "unauth GET /joe/ore/rpc must never 404");
    assert(fetchCalls.length === 0, "unauth GET /joe/ore/rpc must not proxy");

    const missingRpcPost = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore/rpc", { method: "POST" }),
      env,
      ctx,
    );
    assert(missingRpcPost.status === 401, `unauth POST /joe/ore/rpc → 401, got ${missingRpcPost.status}`);
    assert(missingRpcPost.status !== 404, "unauth POST /joe/ore/rpc must never 404");
    assert(fetchCalls.length === 0, "unauth POST /joe/ore/rpc must not proxy");

    const missingSubGet = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore/subscribe", { method: "GET" }),
      env,
      ctx,
    );
    assert(missingSubGet.status === 401, `unauth GET /joe/ore/subscribe → 401, got ${missingSubGet.status}`);
    assert(missingSubGet.status !== 404, "unauth GET /joe/ore/subscribe must never 404");
    assert(fetchCalls.length === 0, "unauth GET /joe/ore/subscribe must not proxy");

    const missingSubPost = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore/subscribe", { method: "POST" }),
      env,
      ctx,
    );
    assert(missingSubPost.status === 401, `unauth POST /joe/ore/subscribe → 401, got ${missingSubPost.status}`);
    assert(missingSubPost.status !== 404, "unauth POST /joe/ore/subscribe must never 404");
    assert(fetchCalls.length === 0, "unauth POST /joe/ore/subscribe must not proxy");

    const extra = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore/extra", { method: "GET" }),
      env,
      ctx,
    );
    assert(extra.status === 404, `unrelated /joe/ore/extra is not a porch path (404), got ${extra.status}`);
    assert(fetchCalls.length === 0, "/joe/ore/extra must not proxy");

    const queryToken = await worker.fetch(
      new Request(`https://mcp.jettoptics.ai/joe/ore/rpc?token=${JOE_TOKEN}`, { method: "GET" }),
      env,
      ctx,
    );
    assert(queryToken.status === 401, `token in URL → 401, got ${queryToken.status}`);
    assert(fetchCalls.length === 0, "query-string token must not proxy");

    const wrong = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore/rpc", {
        method: "POST",
        headers: { "X-JOE-Token": "wrong-token" },
      }),
      env,
      ctx,
    );
    assert(wrong.status === 401, `wrong token → 401, got ${wrong.status}`);
    assert(fetchCalls.length === 0, "wrong token must not proxy or count");

    const rpcOk = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore/rpc", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${JOE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ program: ORE_PROGRAM, method: "rpc" }),
      }),
      env,
      ctx,
    );
    assert(rpcOk.status === 200, `valid Bearer POST /joe/ore/rpc → proxy 200, got ${rpcOk.status}`);
    assert(fetchCalls.length === 1, `valid token proxies once, got ${fetchCalls.length}`);
    assert(
      isExactAaronOrePath(fetchCalls[0].url, "/joe/ore/rpc"),
      `proxied to AARON_ORIGIN /joe/ore/rpc, got ${fetchCalls[0].url}`,
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
    const rpcGetOk = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore/rpc", {
        method: "GET",
        headers: { "X-JOE-Token": JOE_TOKEN },
      }),
      env,
      ctx,
    );
    assert(rpcGetOk.status === 200, `X-JOE-Token GET /joe/ore/rpc → proxy 200, got ${rpcGetOk.status}`);
    assert(
      fetchCalls.length === 1 && isExactAaronOrePath(fetchCalls[0].url, "/joe/ore/rpc"),
      `X-JOE-Token GET proxies to AARON_ORIGIN /joe/ore/rpc, got ${fetchCalls[0]?.url}`,
    );
    assert(!fetchCalls[0].url.includes("helius"), "authenticated GET /joe/ore/rpc must not hit Helius");

    fetchCalls = [];
    const subOk = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/ore/subscribe", {
        method: "GET",
        headers: { Authorization: `Bearer ${JOE_TOKEN}` },
      }),
      env,
      ctx,
    );
    assert(subOk.status === 200, `GET /joe/ore/subscribe → proxy 200, got ${subOk.status}`);
    assert(
      fetchCalls.length === 1 && isExactAaronOrePath(fetchCalls[0].url, "/joe/ore/subscribe"),
      `GET /joe/ore/subscribe proxies to AARON_ORIGIN /joe/ore/subscribe, got ${fetchCalls[0]?.url}`,
    );
    assert(!fetchCalls[0].url.includes("helius"), "authenticated subscribe must not hit Helius");

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
      fetchCalls.length === 1 && isExactAaronOrePath(fetchCalls[0].url, "/joe/ore/sse"),
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
      "ok: /joe/ore/rpc and /joe/ore/subscribe are JOE-gated to AARON_ORIGIN; unauth GET/POST are 401; no Helius on Worker",
    );
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
