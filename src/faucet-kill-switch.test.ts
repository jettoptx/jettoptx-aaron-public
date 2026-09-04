/**
 * Emergency edge kill-switch: POST/GET /faucet/claim and /faucet/sol
 * return 401 {error:"faucet temporarily disabled"} and never proxy to
 * AARON_ORIGIN. x402 catalog stays 200 payTo 5ct4. No prima_title.
 * Hedgehog OAuth unchanged. No payTo flip, no Stripe, no leftover DNS,
 * no jtx.chat 301.
 *
 * Run: npm test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./index";
import { isAaronPath, isJoeHedgehogPath } from "./aaron-gateway";
import {
  DOCS_DISABLED_ERROR,
  FAUCET_DISABLED_ERROR,
  isAaronDocsKillSwitchPath,
  isFaucetKillSwitchPath,
} from "./faucet-kill-switch";
import { isHedgehogPath } from "./hedgehog-mcp";
import type { GatewayEnv } from "./lib/cors";
import { FAUCET_PAY_TO, buildX402Catalog, isX402CatalogPath } from "./x402-catalog";

const AARON_ORIGIN = "https://aaron.example.test";
const HEDGEHOG_ORIGIN = "https://hedgehog.example.test";
const JOE_TOKEN = "test-joe-token";
const AARON_HOST = "https://aaron.jettoptics.ai";
const MCP_HOST = "https://mcp.jettoptics.ai";

const FAUCET_PATHS = ["/faucet/claim", "/faucet/claim/", "/faucet/sol", "/faucet/sol/"] as const;
const DOCS_PATHS = ["/docs", "/docs/", "/redoc", "/redoc/", "/openapi.json"] as const;

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
    if (url.includes("stripe") || url.includes("api.stripe.com")) {
      throw new Error(`Worker must not call Stripe, got ${url}`);
    }
    if (url.startsWith(AARON_ORIGIN) || url.startsWith(HEDGEHOG_ORIGIN)) {
      fetchCalls.push({ url, method });
      return new Response(JSON.stringify({ claimed: true, source: "aaron-origin-DRAIN" }), {
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

async function assertKillSwitch(
  host: string,
  path: string,
  method: string,
  expectedError: string,
): Promise<void> {
  const before = fetchCalls.length;
  const res = await worker.fetch(new Request(`${host}${path}`, { method }), env, ctx);
  assert(res.status === 401, `${method} ${host}${path} → 401, got ${res.status}`);
  assert(res.status !== 200, `${method} ${host}${path} must never 200 claimed`);
  assert(res.status !== 301 && res.status !== 302, `${method} ${host}${path} must not redirect`);
  const loc = res.headers.get("Location") ?? "";
  assert(!loc.includes("jtx.chat"), `${method} ${host}${path} must not 301 to jtx.chat`);
  const body = (await res.json()) as { error?: string; claimed?: unknown };
  assert(body.error === expectedError, `${method} ${path} error must be ${JSON.stringify(expectedError)}, got ${JSON.stringify(body.error)}`);
  assert(body.claimed === undefined, `${method} ${path} must not return claimed`);
  assert(fetchCalls.length === before, `${method} ${path} must NOT proxy to AARON_ORIGIN (calls=${fetchCalls.length})`);
}

async function run(): Promise<void> {
  assert(isFaucetKillSwitchPath("/faucet/claim") === true, "exact /faucet/claim");
  assert(isFaucetKillSwitchPath("/faucet/claim/") === true, "optional slash /faucet/claim/");
  assert(isFaucetKillSwitchPath("/faucet/sol") === true, "exact /faucet/sol");
  assert(isFaucetKillSwitchPath("/faucet/sol/") === true, "optional slash /faucet/sol/");
  assert(isFaucetKillSwitchPath("/faucet") === false, "/faucet is not this door");
  assert(isFaucetKillSwitchPath("/faucet/") === false, "/faucet/ is not this door");
  assert(isFaucetKillSwitchPath("/faucet/status") === false, "unrelated /faucet/status is not stolen");
  assert(isFaucetKillSwitchPath("/faucet/claim/extra") === false, "prefix /faucet/claim/extra is not this door");
  assert(isFaucetKillSwitchPath("/session") === false, "/session is not a faucet kill path");
  assert(isFaucetKillSwitchPath("/x402") === false, "/x402 is not a faucet kill path");

  assert(isAaronDocsKillSwitchPath("/docs") === true, "exact /docs");
  assert(isAaronDocsKillSwitchPath("/redoc") === true, "exact /redoc");
  assert(isAaronDocsKillSwitchPath("/openapi.json") === true, "exact /openapi.json");
  assert(isAaronDocsKillSwitchPath("/docs/oauth2-redirect") === false, "/docs/oauth2-redirect stays origin-side");

  assert(isAaronPath("/faucet/claim") === false, "/faucet/claim is not in AARON_PATHS");
  assert(isAaronPath("/faucet/sol") === false, "/faucet/sol is not in AARON_PATHS");
  assert(isAaronPath("/docs") === false, "/docs is not in AARON_PATHS");
  assert(isHedgehogPath("/faucet/claim") === false, "faucet is not hedgehog");
  assert(isJoeHedgehogPath("/faucet/claim") === false, "faucet is not /joe/hedgehog");

  const catalog = buildX402Catalog();
  assert(catalog.payTo === FAUCET_PAY_TO, "payTo must stay 5ct4 faucet");
  assert(catalog.payTo.startsWith("5ct4"), `payTo must start 5ct4, got ${catalog.payTo}`);
  assert(!catalog.services.some((s) => s.id === "prima_title"), "prima_title must stay gone");
  assert(isX402CatalogPath("/x402") === true, "GET /x402 stays the catalog path");

  const wranglerPath = join(dirname(fileURLToPath(import.meta.url)), "..", "wrangler.toml");
  const wrangler = readFileSync(wranglerPath, "utf8");
  const routePatterns = [...wrangler.matchAll(/^\s*pattern\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert(routePatterns.includes("aaron.jettoptics.ai/faucet/claim*"), "wrangler attaches faucet/claim*");
  assert(routePatterns.includes("aaron.jettoptics.ai/faucet/sol*"), "wrangler attaches faucet/sol*");
  assert(routePatterns.includes("aaron.jettoptics.ai/docs"), "wrangler attaches exact /docs");
  assert(routePatterns.includes("aaron.jettoptics.ai/redoc"), "wrangler attaches exact /redoc");
  assert(routePatterns.includes("aaron.jettoptics.ai/openapi.json"), "wrangler attaches exact /openapi.json");
  assert(
    !routePatterns.some((p) => p === "aaron.jettoptics.ai/*" || p === "aaron.jettoptics.ai"),
    "must not steal the whole aaron host",
  );
  assert(!routePatterns.includes("aaron.jettoptics.ai/faucet"), "must not attach /faucet without claim|sol");
  assert(!routePatterns.includes("aaron.jettoptics.ai/faucet/*"), "must not steal all /faucet/*");
  assert(!routePatterns.some((p) => p.includes("jtx.chat")), "no leftover jtx.chat DNS / route");
  assert(!routePatterns.some((p) => p.toLowerCase().includes("custom_domain")), "no leftover custom_domain DNS");
  assert(!wrangler.toLowerCase().includes("stripe"), "wrangler must not add Stripe");

  installFetchMock();
  try {
    for (const host of [AARON_HOST, MCP_HOST]) {
      for (const path of FAUCET_PATHS) {
        await assertKillSwitch(host, path, "POST", FAUCET_DISABLED_ERROR);
        await assertKillSwitch(host, path, "GET", FAUCET_DISABLED_ERROR);
      }
      for (const path of DOCS_PATHS) {
        await assertKillSwitch(host, path, "GET", DOCS_DISABLED_ERROR);
        await assertKillSwitch(host, path, "POST", DOCS_DISABLED_ERROR);
      }
    }

    const authedClaim = await worker.fetch(
      new Request(`${AARON_HOST}/faucet/claim`, {
        method: "POST",
        headers: { Authorization: `Bearer ${JOE_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: "drain" }),
      }),
      env,
      ctx,
    );
    assert(authedClaim.status === 401, `JOE token must not bypass faucet kill-switch, got ${authedClaim.status}`);
    const authedBody = (await authedClaim.json()) as { error?: string };
    assert(authedBody.error === FAUCET_DISABLED_ERROR, "authed claim still faucet-disabled");
    assert(fetchCalls.length === 0, "authed claim must not proxy");

    const extra = await worker.fetch(new Request(`${MCP_HOST}/faucet/status`, { method: "POST" }), env, ctx);
    assert(extra.status === 404, `unrelated /faucet/status is not stolen (404), got ${extra.status}`);
    assert(fetchCalls.length === 0, "/faucet/status must not proxy");

    const catalogRes = await worker.fetch(new Request(`${AARON_HOST}/x402`, { method: "GET" }), env, ctx);
    assert(catalogRes.status === 200, `GET /x402 catalog still 200, got ${catalogRes.status}`);
    const catalogJson = (await catalogRes.json()) as {
      payTo?: string;
      services?: { id: string }[];
    };
    assert(catalogJson.payTo === FAUCET_PAY_TO, `catalog payTo stays 5ct4, got ${catalogJson.payTo}`);
    assert(catalogJson.payTo === "5ct4GDdvNV4GLEgQ595yegWH5Eyrp2hBGuabz2ZyCbyc", "no payTo flip");
    const ids = (catalogJson.services ?? []).map((s) => s.id);
    assert(!ids.includes("prima_title"), "catalog must not list prima_title");
    assert(ids.join(",") === "chat,gaze_analyze,task,orphan_donate", `catalog SKUs unchanged, got ${ids.join(",")}`);
    assert(fetchCalls.length === 0, "GET /x402 catalog must not proxy");

    const oauthMeta = await worker.fetch(
      new Request(`${MCP_HOST}/.well-known/oauth-authorization-server`, { method: "GET" }),
      env,
      ctx,
    );
    assert(oauthMeta.status === 200, `hedgehog OAuth AS metadata still 200, got ${oauthMeta.status}`);
    assert(oauthMeta.status !== 301, "OAuth metadata must not 301");
    const oauthJson = (await oauthMeta.json()) as { issuer?: string };
    assert(typeof oauthJson.issuer === "string" && oauthJson.issuer.length > 0, "OAuth issuer present");
    assert(fetchCalls.length === 0, "OAuth metadata must not proxy to AARON_ORIGIN");

    const hedgehogUnauth = await worker.fetch(new Request(`${MCP_HOST}/joe/hedgehog`, { method: "POST" }), env, ctx);
    assert(hedgehogUnauth.status === 401, `unauth /joe/hedgehog still 401, got ${hedgehogUnauth.status}`);
    const www = hedgehogUnauth.headers.get("WWW-Authenticate") ?? "";
    assert(www.length > 0, "hedgehog OAuth WWW-Authenticate unchanged");
    const hedgehogBody = (await hedgehogUnauth.json()) as { error?: string };
    assert(hedgehogBody.error !== FAUCET_DISABLED_ERROR, "hedgehog 401 is not the faucet kill-switch");
    assert(fetchCalls.length === 0, "unauth /joe/hedgehog must not proxy");

    const session = await worker.fetch(new Request(`${MCP_HOST}/session`, { method: "GET" }), env, ctx);
    assert(session.status === 200, `/session still proxied ungated, got ${session.status}`);
    assert(
      fetchCalls.some((c) => c.url.startsWith(`${AARON_ORIGIN}/session`)),
      "/session still goes to AARON_ORIGIN (unrelated aaron route not stolen)",
    );
  } finally {
    restoreFetch();
  }
}

run()
  .then(() => {
    console.log(
      "ok: faucet claim/sol → 401 no AARON_ORIGIN proxy; x402 catalog 200 payTo 5ct4; no prima_title; hedgehog OAuth unchanged",
    );
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
