/**
 * CORS allowlist: reflect ACAO only for CORS_PROD_DOMAINS / CORS_DEV_DOMAINS.
 * Foreign Origins (e.g. https://evil.example) must never get ACAO *.
 * Missing Origin omits ACAO so Origin-less API clients still work.
 *
 * Run: npm test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../index";
import type { GatewayEnv } from "./cors";
import { getCorsHeaders, originMatchesAllowlist, parseCorsAllowlist } from "./cors";

const AARON_ORIGIN = "https://aaron.example.test";
const HEDGEHOG_ORIGIN = "https://hedgehog.example.test";
const MCP_HOST = "https://mcp.jettoptics.ai";

const WRANGLER_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "wrangler.toml");

function wranglerCorsProdDomains(): string {
  const wrangler = readFileSync(WRANGLER_PATH, "utf8");
  const match = wrangler.match(/^\s*CORS_PROD_DOMAINS\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error("wrangler.toml must define CORS_PROD_DOMAINS");
  }
  return match[1];
}

const CORS_PROD_DOMAINS = wranglerCorsProdDomains();

const env: GatewayEnv = {
  AARON_ORIGIN,
  HEDGEHOG_ORIGIN,
  ENV: "test",
  CORS_PROD_DOMAINS,
  CORS_DEV_DOMAINS: "",
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

function corsRequest(origin?: string, method = "GET", path = "/x402"): Request {
  const headers = new Headers();
  if (origin !== undefined) {
    headers.set("Origin", origin);
  }
  return new Request(`${MCP_HOST}${path}`, { method, headers });
}

function assertNoAcaoStar(headers: Headers, label: string): void {
  const acao = headers.get("Access-Control-Allow-Origin");
  assert(acao !== "*", `${label} must not set ACAO *, got ${acao}`);
  const creds = headers.get("Access-Control-Allow-Credentials");
  assert(creds !== "true" || acao !== "*", `${label} must not pair credentials:true with ACAO *`);
}

function assertPublicAllowHeaders(headers: Headers, label: string): void {
  const acah = headers.get("Access-Control-Allow-Headers") ?? "";
  assert(acah.includes("Authorization"), `${label} ACAH must keep Authorization`);
  assert(acah.includes("X-JOE-Token"), `${label} ACAH must keep X-JOE-Token`);
  assert(acah.includes("X-PAYMENT"), `${label} ACAH must keep X-PAYMENT`);
  assert(acah.includes("PAYMENT-SIGNATURE"), `${label} ACAH must keep PAYMENT-SIGNATURE`);
  assert(acah.includes("MCP-Protocol-Version"), `${label} ACAH must keep MCP-Protocol-Version`);
  assert(acah.includes("Mcp-Session-Id"), `${label} ACAH must keep Mcp-Session-Id`);
  assert(!/CF-Access-Client-Id/i.test(acah), `${label} ACAH must drop CF-Access-Client-Id`);
  assert(!/CF-Access-Client-Secret/i.test(acah), `${label} ACAH must drop CF-Access-Client-Secret`);
}

async function run(): Promise<void> {
  const allowed = parseCorsAllowlist(env);
  assert(allowed.includes("https://*.jettoptics.ai"), "binding includes https://*.jettoptics.ai");
  assert(allowed.includes("https://grok.com"), "binding includes https://grok.com");
  assert(allowed.includes("https://*.grok.com"), "binding includes https://*.grok.com");
  assert(allowed.includes("http://localhost:*"), "binding includes http://localhost:*");

  assert(originMatchesAllowlist("https://aaron.jettoptics.ai", allowed) === true, "aaron.jettoptics.ai matches *.jettoptics.ai");
  assert(originMatchesAllowlist("https://grok.com", allowed) === true, "grok.com is allowlisted");
  assert(originMatchesAllowlist("https://chat.grok.com", allowed) === true, "chat.grok.com matches *.grok.com");
  assert(originMatchesAllowlist("http://localhost:8787", allowed) === true, "localhost:8787 matches localhost:*");
  assert(originMatchesAllowlist("https://evil.example", allowed) === false, "evil.example is not allowlisted");
  assert(originMatchesAllowlist("https://grok.com.evil.example", allowed) === false, "prefix spoof of grok.com is not allowlisted");
  assert(originMatchesAllowlist("", allowed) === false, "empty Origin is not allowlisted");

  const evilHeaders = getCorsHeaders(corsRequest("https://evil.example"), env);
  assert(evilHeaders.get("Access-Control-Allow-Origin") === null, "evil Origin must omit ACAO");
  assertNoAcaoStar(evilHeaders, "evil Origin helper");
  assertPublicAllowHeaders(evilHeaders, "evil Origin helper");

  const missingHeaders = getCorsHeaders(corsRequest(undefined), env);
  assert(missingHeaders.get("Access-Control-Allow-Origin") === null, "missing Origin must omit ACAO");
  assertNoAcaoStar(missingHeaders, "missing Origin helper");

  const aaronHeaders = getCorsHeaders(corsRequest("https://aaron.jettoptics.ai"), env);
  assert(
    aaronHeaders.get("Access-Control-Allow-Origin") === "https://aaron.jettoptics.ai",
    `aaron Origin must be reflected, got ${aaronHeaders.get("Access-Control-Allow-Origin")}`,
  );
  assertNoAcaoStar(aaronHeaders, "aaron Origin helper");
  assertPublicAllowHeaders(aaronHeaders, "aaron Origin helper");
  assert(aaronHeaders.get("Access-Control-Allow-Credentials") !== "true", "must not set credentials:true");

  const grokHeaders = getCorsHeaders(corsRequest("https://grok.com"), env);
  assert(
    grokHeaders.get("Access-Control-Allow-Origin") === "https://grok.com",
    `grok.com must be reflected, got ${grokHeaders.get("Access-Control-Allow-Origin")}`,
  );

  installFetchMock();
  try {
    const evilPreflight = await worker.fetch(
      corsRequest("https://evil.example", "OPTIONS", "/mcp"),
      env,
      ctx,
    );
    assert(evilPreflight.status === 204, `evil OPTIONS → 204, got ${evilPreflight.status}`);
    assert(evilPreflight.headers.get("Access-Control-Allow-Origin") === null, "evil OPTIONS must omit ACAO");
    assertNoAcaoStar(evilPreflight.headers, "evil OPTIONS");
    assertPublicAllowHeaders(evilPreflight.headers, "evil OPTIONS");

    const aaronPreflight = await worker.fetch(
      corsRequest("https://aaron.jettoptics.ai", "OPTIONS", "/mcp"),
      env,
      ctx,
    );
    assert(aaronPreflight.status === 204, `allowlisted OPTIONS → 204, got ${aaronPreflight.status}`);
    assert(
      aaronPreflight.headers.get("Access-Control-Allow-Origin") === "https://aaron.jettoptics.ai",
      `allowlisted OPTIONS must reflect ACAO, got ${aaronPreflight.headers.get("Access-Control-Allow-Origin")}`,
    );
    assertNoAcaoStar(aaronPreflight.headers, "allowlisted OPTIONS");

    const grokGet = await worker.fetch(corsRequest("https://grok.com", "GET", "/x402"), env, ctx);
    assert(grokGet.status === 200, `allowlisted GET /x402 still 200, got ${grokGet.status}`);
    assert(
      grokGet.headers.get("Access-Control-Allow-Origin") === "https://grok.com",
      `allowlisted GET must reflect ACAO, got ${grokGet.headers.get("Access-Control-Allow-Origin")}`,
    );

    const evilGet = await worker.fetch(corsRequest("https://evil.example", "GET", "/x402"), env, ctx);
    assert(evilGet.status === 200, `evil GET /x402 still 200 (API), got ${evilGet.status}`);
    assert(evilGet.headers.get("Access-Control-Allow-Origin") === null, "evil GET must omit ACAO");
    assertNoAcaoStar(evilGet.headers, "evil GET /x402");

    const noOriginGet = await worker.fetch(corsRequest(undefined, "GET", "/x402"), env, ctx);
    assert(noOriginGet.status === 200, `Origin-less GET /x402 still 200, got ${noOriginGet.status}`);
    assert(noOriginGet.headers.get("Access-Control-Allow-Origin") === null, "Origin-less GET must omit ACAO");

    const session = await worker.fetch(corsRequest("https://evil.example", "GET", "/session"), env, ctx);
    assert(session.status === 200, `/session bootstrap still proxied, got ${session.status}`);
    assert(
      fetchCalls.some((c) => c.url.startsWith(`${AARON_ORIGIN}/session`)),
      "/session still goes to AARON_ORIGIN",
    );
    assert(session.headers.get("Access-Control-Allow-Origin") === null, "evil /session must omit ACAO");
    assertNoAcaoStar(session.headers, "evil /session");
  } finally {
    restoreFetch();
  }
}

run()
  .then(() => {
    console.log("ok: CORS allowlist reflects ACAO; evil Origin never gets *; /session unchanged");
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
