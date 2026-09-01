/**
 * Proves POST/GET /joe/hedgehog is JOE-gated and proxied to AARON_ORIGIN,
 * not AARON_PATHS, not Hedgehog :8811, and not swallowed as /mcp/*.
 * GET /mcp/jettchat and POST /mcp stay unchanged. /joe/mcp is a separate door.
 *
 * Run: npm test
 */
import worker from "./index";
import { isAaronPath, isJoeHedgehogPath } from "./aaron-gateway";
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
  assert(isJoeHedgehogPath("/joe/hedgehog") === true, "exact /joe/hedgehog is the Joe/hedgehog door");
  assert(isJoeHedgehogPath("/joe/hedgehog/") === true, "optional trailing slash is the Joe/hedgehog door");
  assert(isJoeHedgehogPath("/joe/hedgehog/sse") === true, "/joe/hedgehog/sse is the Joe/hedgehog SSE sibling");
  assert(isJoeHedgehogPath("/joe/mcp") === false, "/joe/mcp is a separate Joe MCP door");
  assert(isJoeHedgehogPath("/mcp") === false, "/mcp is not the Joe/hedgehog door");
  assert(isJoeHedgehogPath("/mcp/jettchat") === false, "census path is not the Joe/hedgehog door");
  assert(isJoeHedgehogPath("/joe/hedgehog/extra") === false, "prefix /joe/hedgehog/extra is not this door");

  assert(isHedgehogPath("/joe/hedgehog") === false, "/joe/hedgehog is not swallowed as /mcp/*");
  assert(isHedgehogPath("/mcp") === true, "POST /mcp stays hedgehog");
  assert(isAaronPath("/joe/hedgehog") === false, "/joe/hedgehog is not in AARON_PATHS");
  assert(isAaronPath("/joe/hedgehog/") === false, "/joe/hedgehog/ is not in AARON_PATHS");
  assert(isAaronPath("/joe/hedgehog/sse") === false, "/joe/hedgehog/sse is not in AARON_PATHS");
  assert(isAaronPath("/session") === true, "/session remains an ungated Aaron path");

  assert(isJettchatCensusPath("/mcp/jettchat") === true, "GET /mcp/jettchat is still the census special case");
  assert(isJettchatCensusPath("/joe/hedgehog") === false, "Joe/hedgehog is not the census path");

  installFetchMock();
  try {
    const missing = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/hedgehog", { method: "POST" }),
      env,
      ctx,
    );
    assert(missing.status === 401, `missing token → 401, got ${missing.status}`);
    assert(missing.status !== 404, "unauth /joe/hedgehog must never 404");
    const www = missing.headers.get("WWW-Authenticate") ?? "";
    assert(www.startsWith("Bearer "), `401 WWW-Authenticate must be Bearer, got ${www}`);
    assert(
      www.includes("resource_metadata="),
      `401 WWW-Authenticate must point at OAuth protected-resource metadata, got ${www}`,
    );
    assert(
      www.includes("/.well-known/oauth-protected-resource/joe/hedgehog"),
      `resource_metadata must be the hedgehog porch document, got ${www}`,
    );
    assert(fetchCalls.length === 0, "missing token must not proxy or count");

    const missingGet = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/hedgehog", { method: "GET" }),
      env,
      ctx,
    );
    assert(missingGet.status === 401, `unauth GET /joe/hedgehog → 401, got ${missingGet.status}`);
    assert(missingGet.status !== 404, "unauth GET /joe/hedgehog must never 404");
    assert(
      (missingGet.headers.get("WWW-Authenticate") ?? "").includes("resource_metadata="),
      "unauth GET must also advertise resource_metadata",
    );

    const wrong = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/hedgehog", {
        method: "POST",
        headers: { "X-JOE-Token": "wrong-token" },
      }),
      env,
      ctx,
    );
    assert(wrong.status === 401, `wrong token → 401, got ${wrong.status}`);
    assert(fetchCalls.length === 0, "wrong token must not proxy or count");

    const ok = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/hedgehog", {
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
      fetchCalls[0].url.startsWith(`${AARON_ORIGIN}/joe/hedgehog`),
      `proxied to AARON_ORIGIN /joe/hedgehog, got ${fetchCalls[0].url}`,
    );
    assert(fetchCalls[0].method === "POST", `POST is forwarded, got ${fetchCalls[0].method}`);
    assert(!fetchCalls[0].url.includes("8811"), "must not proxy to Hedgehog :8811");
    assert(!fetchCalls[0].url.startsWith(HEDGEHOG_ORIGIN), "must not proxy to HEDGEHOG_ORIGIN");
    assert(!fetchCalls[0].url.includes("stdb."), "Joe/hedgehog must not call SpacetimeDB");
    assert(!fetchCalls[0].url.includes("/joe/mcp"), "Joe/hedgehog must not rewrite to /joe/mcp");

    fetchCalls = [];
    const headerOk = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/hedgehog", {
        method: "GET",
        headers: { "X-JOE-Token": JOE_TOKEN },
      }),
      env,
      ctx,
    );
    assert(headerOk.status === 200, `X-JOE-Token GET → proxy 200, got ${headerOk.status}`);
    assert(
      fetchCalls.length === 1 && fetchCalls[0].url.startsWith(`${AARON_ORIGIN}/joe/hedgehog`),
      "X-JOE-Token also proxies to AARON_ORIGIN /joe/hedgehog",
    );

    fetchCalls = [];
    const sseOk = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/joe/hedgehog/sse", {
        method: "GET",
        headers: { Authorization: `Bearer ${JOE_TOKEN}` },
      }),
      env,
      ctx,
    );
    assert(sseOk.status === 200, `GET /joe/hedgehog/sse → proxy 200, got ${sseOk.status}`);
    assert(
      fetchCalls.length === 1 && fetchCalls[0].url.startsWith(`${AARON_ORIGIN}/joe/hedgehog/sse`),
      `SSE sibling proxies to AARON_ORIGIN /joe/hedgehog/sse, got ${fetchCalls[0]?.url}`,
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
      "ok: /joe/hedgehog is JOE-gated and proxied to AARON_ORIGIN; POST /mcp and GET /mcp/jettchat unchanged",
    );
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
