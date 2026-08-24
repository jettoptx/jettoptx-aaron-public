/**
 * Proves GET /x402/prima_title is an edge 402 door with payTo GtAk
 * (astro.knots.sol), never the faucet 5ct4, and never a 404.
 * Catalog GET /x402 lists the four existing services plus prima_title.
 *
 * Run: npm test
 */
import worker from "./index";
import { isAaronPath } from "./aaron-gateway";
import type { GatewayEnv } from "./lib/cors";
import {
  FAUCET_PAY_TO,
  PRIMA_PAY_TO,
  PRIMA_PAY_TO_DOMAIN,
  PRIMA_PRICE_ATOMIC,
  PRIMA_PRICE_ATOMIC_STR,
  PRIMA_PRICE_USDC,
  PRIMA_RESOURCE_URL,
  PRIMA_TITLE_KIND,
  PRIMA_TITLE_WALLET,
  USDC_MINT,
  buildPrimaTitleChallenge,
  buildPrimaTitleMeter,
  buildX402Catalog,
  isPrimaTitlePath,
  isX402CatalogPath,
} from "./x402-prima-title";

const AARON_ORIGIN = "https://aaron.example.test";
const HEDGEHOG_ORIGIN = "https://hedgehog.example.test";

const env: GatewayEnv = {
  AARON_ORIGIN,
  HEDGEHOG_ORIGIN,
  ENV: "test",
};

const ctx = {} as ExecutionContext;

type FetchCall = { url: string; method: string; body?: string };
let fetchCalls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

function installFetchMock(opts?: { settleOk?: boolean }): void {
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
    const body = typeof init?.body === "string" ? init.body : undefined;
    fetchCalls.push({ url, method, body });

    if (typeof body === "string" && body.includes("getTransaction")) {
      if (!opts?.settleOk) {
        return new Response(JSON.stringify({ result: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          result: {
            meta: {
              err: null,
              preTokenBalances: [
                {
                  mint: USDC_MINT,
                  owner: PRIMA_PAY_TO,
                  uiTokenAmount: { amount: "0" },
                },
              ],
              postTokenBalances: [
                {
                  mint: USDC_MINT,
                  owner: PRIMA_PAY_TO,
                  uiTokenAmount: { amount: PRIMA_PRICE_ATOMIC_STR },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.startsWith(AARON_ORIGIN) || url.startsWith(HEDGEHOG_ORIGIN)) {
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

const VALID_SIG = "1111111111111111111111111111111111111111111111111111111111111111";

async function run(): Promise<void> {
  assert(isPrimaTitlePath("/x402/prima_title") === true, "exact prima_title path");
  assert(isPrimaTitlePath("/x402/prima_title/") === true, "trailing slash prima_title");
  assert(isPrimaTitlePath("/x402") === false, "catalog is not prima_title");
  assert(isPrimaTitlePath("/x402/v1/chat") === false, "chat is not prima_title");
  assert(isX402CatalogPath("/x402") === true, "exact catalog path");
  assert(isX402CatalogPath("/x402/") === true, "trailing slash catalog");
  assert(isX402CatalogPath("/x402/prima_title") === false, "prima_title is not catalog");
  assert(isAaronPath("/x402/prima_title") === true, "path still matches AARON prefix (first-match must win)");
  assert(isAaronPath("/x402") === true, "catalog still matches AARON prefix");

  const challenge = buildPrimaTitleChallenge();
  const accept = challenge.accepts[0];
  assert(accept.payTo === PRIMA_PAY_TO, `challenge payTo must be GtAk, got ${accept.payTo}`);
  assert(accept.payTo !== FAUCET_PAY_TO, "challenge payTo must not be faucet 5ct4");
  assert(accept.maxAmountRequired === PRIMA_PRICE_ATOMIC_STR, "reused task atomic amount");
  assert(accept.extra.payToDomain === PRIMA_PAY_TO_DOMAIN, "challenge domain is astro.knots.sol");
  assert(accept.resource === PRIMA_RESOURCE_URL, "resource prefers aaron.jettoptics.ai");
  assert(accept.asset === USDC_MINT, "USDC mint");

  const catalog = buildX402Catalog();
  assert(catalog.payTo === FAUCET_PAY_TO, "catalog top-level payTo stays 5ct4");
  assert(catalog.payToDomain === "jtxfaucet.sol", "catalog faucet domain unchanged");
  const ids = catalog.services.map((s) => s.id);
  assert(ids.join(",") === "chat,gaze_analyze,task,orphan_donate,prima_title", `service ids ${ids.join(",")}`);
  const prima = catalog.services.find((s) => s.id === "prima_title");
  assert(prima, "prima_title listed");
  assert("payTo" in (prima ?? {}) && (prima as { payTo?: string }).payTo === PRIMA_PAY_TO, "prima dest/payTo GtAk");
  assert("dest" in (prima ?? {}) && (prima as { dest?: string }).dest === PRIMA_PAY_TO, "prima dest GtAk");
  assert((prima as { priceUsdc?: number }).priceUsdc === PRIMA_PRICE_USDC, "reused task 0.05");
  assert((prima as { priceAtomic?: number }).priceAtomic === PRIMA_PRICE_ATOMIC, "reused task 50000");
  for (const id of ["chat", "gaze_analyze", "task", "orphan_donate"] as const) {
    const row = catalog.services.find((s) => s.id === id) as { payTo?: string; dest?: string };
    assert(row, `kept ${id}`);
    assert(row.payTo !== PRIMA_PAY_TO, `${id} must not flip to GtAk`);
    assert(!row.payTo || row.payTo === FAUCET_PAY_TO, `${id} must stay faucet if it has payTo`);
  }

  installFetchMock();
  try {
    for (const host of ["https://aaron.jettoptics.ai", "https://mcp.jettoptics.ai"]) {
      const unauth = await worker.fetch(new Request(`${host}/x402/prima_title`), env, ctx);
      assert(unauth.status === 402, `${host} unauth GET must 402, got ${unauth.status}`);
      assert(unauth.status !== 404, `${host} unauth GET must never 404`);
      assert(unauth.headers.get("X-Pay-To") === PRIMA_PAY_TO, `${host} X-Pay-To must be GtAk`);
      assert(unauth.headers.get("X-Pay-To") !== FAUCET_PAY_TO, `${host} X-Pay-To must not be 5ct4`);
      assert(unauth.headers.get("X-Pay-To-Domain") === PRIMA_PAY_TO_DOMAIN, `${host} domain astro.knots.sol`);
      assert(unauth.headers.get("X-Payment-Required") === "x402", `${host} X-Payment-Required`);
      const body = (await unauth.json()) as {
        accepts?: Array<{ payTo?: string; maxAmountRequired?: string }>;
      };
      assert(body.accepts?.[0]?.payTo === PRIMA_PAY_TO, `${host} body payTo GtAk`);
      assert(body.accepts?.[0]?.payTo !== FAUCET_PAY_TO, `${host} body payTo not 5ct4`);
      assert(body.accepts?.[0]?.maxAmountRequired === PRIMA_PRICE_ATOMIC_STR, `${host} reused task amount`);
    }

    const originHits = fetchCalls.filter((c) => c.url.startsWith(AARON_ORIGIN));
    assert(originHits.length === 0, `unauth prima_title must not proxy, got ${JSON.stringify(originHits)}`);

    fetchCalls = [];
    const listed = await worker.fetch(new Request("https://aaron.jettoptics.ai/x402"), env, ctx);
    assert(listed.status === 200, `catalog 200, got ${listed.status}`);
    const listedBody = (await listed.json()) as {
      payTo?: string;
      services?: Array<{ id?: string; payTo?: string; dest?: string; method?: string; path?: string }>;
    };
    assert(listedBody.payTo === FAUCET_PAY_TO, "live catalog top-level payTo stays 5ct4");
    const listedIds = (listedBody.services ?? []).map((s) => s.id);
    assert(
      listedIds.join(",") === "chat,gaze_analyze,task,orphan_donate,prima_title",
      `catalog services ${listedIds.join(",")}`,
    );
    const listedPrima = listedBody.services?.find((s) => s.id === "prima_title");
    assert(listedPrima?.payTo === PRIMA_PAY_TO && listedPrima.dest === PRIMA_PAY_TO, "catalog prima dest/payTo GtAk");
    assert(listedPrima?.method === "GET" && listedPrima.path === "/x402/prima_title", "catalog prima GET path");
    for (const row of listedBody.services ?? []) {
      if (row.id === "prima_title") continue;
      assert(row.payTo !== PRIMA_PAY_TO, `${row.id} must not flip dest to GtAk`);
    }
    assert(
      fetchCalls.filter((c) => c.url.startsWith(AARON_ORIGIN)).length === 0,
      "assembled catalog must not loop through origin /x402",
    );

    fetchCalls = [];
    const chat = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/x402/v1/chat", { method: "POST", body: "{}" }),
      env,
      ctx,
    );
    assert(chat.status === 200, `other x402 routes still proxy, got ${chat.status}`);
    assert(
      fetchCalls.some((c) => c.url.startsWith(`${AARON_ORIGIN}/x402/v1/chat`)),
      "chat still proxies to origin",
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
    const apex = await worker.fetch(new Request("https://jettoptics.ai/.well-known/x402"), env, ctx);
    assert(apex.status === 404, `do not add apex /.well-known/x402, got ${apex.status}`);
    assert(
      fetchCalls.filter((c) => c.url.includes("/.well-known/x402")).length === 0,
      "apex well-known/x402 must not be invented",
    );
  } finally {
    restoreFetch();
  }

  installFetchMock({ settleOk: true });
  try {
    const settled = await worker.fetch(
      new Request("https://aaron.jettoptics.ai/x402/prima_title", {
        headers: { "X-PAYMENT": VALID_SIG },
      }),
      env,
      ctx,
    );
    assert(settled.status === 200, `valid settle 200, got ${settled.status}`);
    const title = (await settled.json()) as {
      kind?: string;
      operator?: string;
      handle?: string;
      wallet?: string;
      payTo?: string;
      meter?: { grants?: unknown[] };
      notGranted?: string[];
    };
    assert(title.kind === PRIMA_TITLE_KIND, `kind ${title.kind}`);
    assert(title.operator === "Prima", "operator Prima");
    assert(title.handle === "augment", "handle augment");
    assert(title.wallet === PRIMA_TITLE_WALLET, "title wallet DQbS");
    assert(title.payTo === PRIMA_PAY_TO, "settled title payTo stays GtAk");
    assert(title.payTo !== FAUCET_PAY_TO, "settled title payTo is not 5ct4");
    assert(Array.isArray(title.meter?.grants) && title.meter?.grants.length === 0, "meter grants empty");
    for (const denied of ["ncl_voyage_minutes", "starlink_bytes", "boat_ssid", "passenger_location"]) {
      assert(title.notGranted?.includes(denied), `explicitly not granted ${denied}`);
    }
  } finally {
    restoreFetch();
  }

  const meter = await buildPrimaTitleMeter("test-sig");
  assert(meter.kind === PRIMA_TITLE_KIND, "meter kind");
  assert(meter.wallet === PRIMA_TITLE_WALLET, "meter wallet");
  assert(meter.payTo === PRIMA_PAY_TO, "meter payTo GtAk");
}

run()
  .then(() => {
    console.log(
      "ok: GET /x402/prima_title 402s with payTo GtAk; catalog lists prima_title dest GtAk; faucet 5ct4 unchanged",
    );
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
