/**
 * Proves GET/POST /joe/mcp and /joe/mcp/sse are JOE-gated and proxied to
 * AARON_ORIGIN. Header auth only (no token in the URL). Not AARON_PATHS.
 * Not Hedgehog /mcp. Phone sheet cannot auth (no header).
 *
 * Run: npm test
 */
import worker from "./index";
import { isAaronPath, isJoeHedgehogPath, isJoeMcpPath } from "./aaron-gateway";
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
    const method = (
      init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET")
    ).toUpperCase();
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
  assert(isJoeMcpPath("/joe/mcp") === true, "exact /joe/mcp is the Computer AddMcpServer door");
  assert(isJoeMcpPath("/joe/mcp/") === true, "optional trailing slash is the /joe/mcp door");
  assert(isJoeMcpPath("/joe/mcp/sse") === true, "/joe/mcp/sse is the SSE sibling");
  assert(isJoeMcpPath("/joe/mcp/sse/") === true, "optional trailing slash on SSE sibling");
  assert(isJoeMcpPath("/mcp") === false, "/mcp is Hedgehog, not /joe/mcp");
  assert(isJoeMcpPath("/mcp/jettchat") === false, "census is not /joe/mcp");
  assert(isJoeMcpPath("/joe/hedgehog") === false, "Joe/hedgehog is a separate door");
  assert(isJoeMcpPath("/joe/mcp/extra") === false, "prefix /joe/mcp/extra is not this door");

  assert(isJoeHedgehogPath("/joe/mcp") === false, "/joe/mcp is not the Joe/hedgehog matcher");
  assert(isHedgehogPath("/joe/mcp") === false, "/joe/mcp is not treated as Hedgehog /mcp");
  assert(isHedgehogPath("/joe/mcp/sse") === false, "/joe/mcp/sse is not Hedgehog /mcp/*");
  assert(isHedgehogPath("/mcp") === true, "POST /mcp stays hedgehog");
  assert(isAaronPath("/joe/mcp") === false, "/joe/mcp is not in AARON_PATHS");
  assert(isAaronPath("/joe/mcp/") === false, "/joe/mcp/ is not in AARON_PATHS");
  assert(isAaronPath("/joe/mcp/sse") === false, "/joe/mcp/sse is not in AARON_PATHS");
  assert(isJettchatCensusPath("/mcp/jettchat") === true, "GET /mcp/jettchat is still the census special case");

  installFetchMock();
  try {
    const missing = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/mcp", { method: "POST" }),
      env,
      ctx,
    );
    assert(missing.status === 401, `no header → 401, got ${missing.status}`);
    assert(fetchCalls.length === 0, "phone sheet / no header must not proxy");

    const queryToken = await worker.fetch(
      new Request(`https://mcp.jettoptics.ai/joe/mcp?token=${JOE_TOKEN}`, { method: "POST" }),
      env,
      ctx,
    );
    assert(queryToken.status === 401, `token in URL → 401, got ${queryToken.status}`);
    assert(fetchCalls.length === 0, "query-string token must not proxy");

    const queryKey = await worker.fetch(
      new Request(`https://mcp.jettoptics.ai/joe/mcp?key=${JOE_TOKEN}`, { method: "GET" }),
      env,
      ctx,
    );
    assert(queryKey.status === 401, `?key= in URL → 401, got ${queryKey.status}`);
    assert(fetchCalls.length === 0, "?key= must not proxy");

    const wrong = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/mcp", {
        method: "POST",
        headers: { "X-JOE-Token": "wrong-token" },
      }),
      env,
      ctx,
    );
    assert(wrong.status === 401, `wrong token → 401, got ${wrong.status}`);
    assert(fetchCalls.length === 0, "wrong token must not proxy");

    const ok = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/mcp", {
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
    assert(ok.status === 200, `valid Bearer → proxy 200, got ${ok.status}`);
    assert(fetchCalls.length === 1, `valid token proxies once, got ${fetchCalls.length}`);
    assert(
      fetchCalls[0].url.startsWith(`${AARON_ORIGIN}/joe/mcp`),
      `proxied to AARON_ORIGIN /joe/mcp, got ${fetchCalls[0].url}`,
    );
    assert(fetchCalls[0].method === "POST", `POST is forwarded, got ${fetchCalls[0].method}`);
    assert(!fetchCalls[0].url.includes("8811"), "must not proxy to Hedgehog :8811");
    assert(!fetchCalls[0].url.startsWith(HEDGEHOG_ORIGIN), "must not proxy to HEDGEHOG_ORIGIN");
    assert(!fetchCalls[0].url.includes("stdb."), "must not call SpacetimeDB");

    fetchCalls = [];
    const headerOk = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/mcp", {
        method: "GET",
        headers: { "X-JOE-Token": JOE_TOKEN },
      }),
      env,
      ctx,
    );
    assert(headerOk.status === 200, `X-JOE-Token GET → proxy 200, got ${headerOk.status}`);
    assert(
      fetchCalls.length === 1 && fetchCalls[0].url.startsWith(`${AARON_ORIGIN}/joe/mcp`),
      "X-JOE-Token also proxies to AARON_ORIGIN /joe/mcp",
    );

    fetchCalls = [];
    const sseOk = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/mcp/sse", {
        method: "GET",
        headers: { Authorization: `Bearer ${JOE_TOKEN}` },
      }),
      env,
      ctx,
    );
    assert(sseOk.status === 200, `GET /joe/mcp/sse → proxy 200, got ${sseOk.status}`);
    assert(
      fetchCalls.length === 1 && fetchCalls[0].url.startsWith(`${AARON_ORIGIN}/joe/mcp/sse`),
      `SSE sibling proxies to AARON_ORIGIN /joe/mcp/sse, got ${fetchCalls[0]?.url}`,
    );

    fetchCalls = [];
    const ssePost = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/mcp/sse", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${JOE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      }),
      env,
      ctx,
    );
    assert(ssePost.status === 200, `POST /joe/mcp/sse → proxy 200, got ${ssePost.status}`);
    assert(
      fetchCalls.length === 1 &&
        fetchCalls[0].method === "POST" &&
        fetchCalls[0].url.startsWith(`${AARON_ORIGIN}/joe/mcp/sse`),
      "POST /joe/mcp/sse proxies to AARON_ORIGIN",
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
      "ok: /joe/mcp is JOE-gated (header only) and proxied to AARON_ORIGIN; POST /mcp is still hedgehog",
    );
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
