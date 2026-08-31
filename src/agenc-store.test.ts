/**
 * Proves GET /.well-known/agenc-store.json is an unauthenticated 200 JSON door
 * (unsigned, listings [], operator DQbS, dest GtAk, shop agenc.ag/@augment).
 * Never 402. Never payTo / X-Pay-To header. Not proxied. Not AARON_PATHS.
 * GET /.well-known/agent-card.json stays origin-proxied. Apex jettoptics.ai 404s.
 * GET /x402/prima_title stays 402 to GtAk. Faucet 5ct4 services stay proxied.
 *
 * Run: npm test
 */
import worker from "./index";
import { isAaronPath } from "./aaron-gateway";
import type { GatewayEnv } from "./lib/cors";
import {
  AGENC_DEST,
  AGENC_HANDLE,
  AGENC_OPERATOR,
  AGENC_SHOP,
  AGENC_SIGNER,
  AGENC_STORE_BODY,
  AGENC_STORE_PATH,
  isAgencStorePath,
  isApexJettopticsHost,
} from "./agenc-store";
import { FAUCET_PAY_TO, PRIMA_PAY_TO, PRIMA_TITLE_WALLET, isPrimaTitlePath } from "./x402-prima-title";
import { isPrimaDepinJobSpecPath } from "./prima-depin-job-spec";

const AARON_ORIGIN = "https://aaron.example.test";
const HEDGEHOG_ORIGIN = "https://hedgehog.example.test";

const env: GatewayEnv = {
  AARON_ORIGIN,
  HEDGEHOG_ORIGIN,
  ENV: "test",
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
    fetchCalls.push({ url, method });

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

function assertNoPayHeaders(res: Response, label: string): void {
  assert(res.headers.get("X-Pay-To") === null, `${label} must not set X-Pay-To`);
  assert(res.headers.get("X-Pay-To-Domain") === null, `${label} must not set X-Pay-To-Domain`);
  assert(res.headers.get("X-Payment-Required") === null, `${label} must not set X-Payment-Required`);
  assert(res.headers.get("payTo") === null, `${label} must not set payTo header`);
}

async function run(): Promise<void> {
  assert(isAgencStorePath(AGENC_STORE_PATH) === true, "exact store path");
  assert(isAgencStorePath(`${AGENC_STORE_PATH}/`) === true, "trailing slash store path");
  assert(isAgencStorePath("/.well-known/agent-card.json") === false, "agent-card is not the store");
  assert(isAgencStorePath("/.well-known/joe-gateway") === false, "joe-gateway is not the store");
  assert(isAgencStorePath("/specs/prima-depin-job.json") === false, "job spec is not the store");
  assert(isPrimaTitlePath(AGENC_STORE_PATH) === false, "store is not prima_title");
  assert(isPrimaDepinJobSpecPath(AGENC_STORE_PATH) === false, "store is not the job spec");
  assert(isAaronPath(AGENC_STORE_PATH) === false, "store is not in AARON_PATHS");
  assert(isAaronPath("/.well-known/agent-card.json") === true, "agent-card stays an Aaron path");
  assert(isApexJettopticsHost("jettoptics.ai") === true, "apex host");
  assert(isApexJettopticsHost("www.jettoptics.ai") === true, "www apex host");
  assert(isApexJettopticsHost("aaron.jettoptics.ai") === false, "aaron is not apex");
  assert(isApexJettopticsHost("mcp.jettoptics.ai") === false, "mcp is not apex");

  const parsed = JSON.parse(AGENC_STORE_BODY) as {
    shop?: string;
    handle?: string;
    operator?: string;
    dest?: string;
    payTo?: string;
    listings?: unknown;
    signed?: boolean;
    signature?: unknown;
    signer?: string;
    note?: string;
    price?: unknown;
    priceUsdc?: unknown;
  };
  const keys = Object.keys(parsed);
  assert(
    keys.join(",") ===
      "shop,handle,operator,dest,payTo,listings,signed,signature,signer,note",
    `store keys ${keys.join(",")}`,
  );
  assert(parsed.shop === AGENC_SHOP, "shop");
  assert(parsed.shop === "https://agenc.ag/@augment", "shop URL");
  assert(parsed.handle === AGENC_HANDLE, "handle augment");
  assert(parsed.operator === AGENC_OPERATOR, "operator DQbS");
  assert(parsed.operator === PRIMA_TITLE_WALLET, "operator matches public DQbS wallet");
  assert(parsed.dest === AGENC_DEST, "dest GtAk");
  assert(parsed.dest === PRIMA_PAY_TO, "dest matches prima_title payTo GtAk");
  assert(parsed.payTo === PRIMA_PAY_TO, "body payTo GtAk (swarm LOAD)");
  assert(parsed.payTo !== FAUCET_PAY_TO, "body payTo is not faucet 5ct4");
  assert(Array.isArray(parsed.listings) && parsed.listings.length === 0, "listings []");
  assert(parsed.signed === false, "signed false");
  assert(parsed.signature === null, "signature null (unsigned; Worker never signs)");
  assert(parsed.signer === AGENC_SIGNER, "signer backpack");
  assert(
    parsed.note ===
      "Send attests only after dest==GtAk on /x402/swarm or a foreign AgenC hire receipt",
    "Send attest note",
  );
  assert(
    !("price" in parsed) && !("priceUsdc" in parsed) && !("sku" in parsed),
    "store must not invent prices or extra SKUs",
  );

  installFetchMock();
  try {
    for (const host of ["https://aaron.jettoptics.ai", "https://mcp.jettoptics.ai"]) {
      const unauth = await worker.fetch(new Request(`${host}${AGENC_STORE_PATH}`), env, ctx);
      assert(unauth.status === 200, `${host} unauth GET must 200, got ${unauth.status}`);
      assert(unauth.status !== 402, `${host} unauth GET must never 402`);
      assert(unauth.status !== 401, `${host} unauth GET must never 401`);
      assert(
        unauth.headers.get("Content-Type") === "application/json",
        `${host} Content-Type application/json, got ${unauth.headers.get("Content-Type")}`,
      );
      assertNoPayHeaders(unauth, host);
      const raw = await unauth.text();
      assert(raw === AGENC_STORE_BODY, `${host} body must be byte-for-byte exact`);
    }

    fetchCalls = [];
    const slash = await worker.fetch(
      new Request(`https://mcp.jettoptics.ai${AGENC_STORE_PATH}/`),
      env,
      ctx,
    );
    assert(slash.status === 200, "trailing slash GET must 200");
    assert((await slash.text()) === AGENC_STORE_BODY, "trailing slash body exact");
    assertNoPayHeaders(slash, "trailing slash");

    const originHits = fetchCalls.filter((c) => c.url.startsWith(AARON_ORIGIN));
    assert(originHits.length === 0, `store must not proxy, got ${JSON.stringify(originHits)}`);

    fetchCalls = [];
    const withToken = await worker.fetch(
      new Request(`https://aaron.jettoptics.ai${AGENC_STORE_PATH}`, {
        headers: { Authorization: "Bearer unused", "X-JOE-Token": "unused" },
      }),
      env,
      ctx,
    );
    assert(withToken.status === 200, "token present still 200 (door is public, not gated)");
    assert((await withToken.text()) === AGENC_STORE_BODY, "token does not change body");
    assertNoPayHeaders(withToken, "tokened GET");

    fetchCalls = [];
    const head = await worker.fetch(
      new Request(`https://mcp.jettoptics.ai${AGENC_STORE_PATH}`, { method: "HEAD" }),
      env,
      ctx,
    );
    assert(head.status === 200, `HEAD must 200, got ${head.status}`);
    assertNoPayHeaders(head, "HEAD");

    fetchCalls = [];
    const post = await worker.fetch(
      new Request(`https://mcp.jettoptics.ai${AGENC_STORE_PATH}`, { method: "POST", body: "{}" }),
      env,
      ctx,
    );
    assert(post.status === 405, `POST must 405, got ${post.status}`);

    fetchCalls = [];
    const title = await worker.fetch(new Request("https://aaron.jettoptics.ai/x402/prima_title"), env, ctx);
    assert(title.status === 402, `prima_title still 402, got ${title.status}`);
    assert(title.headers.get("X-Pay-To") === PRIMA_PAY_TO, "prima_title X-Pay-To stays GtAk");
    assert(title.headers.get("X-Pay-To") !== FAUCET_PAY_TO, "prima_title X-Pay-To is not 5ct4");
    const titleBody = (await title.json()) as { accepts?: Array<{ payTo?: string }> };
    assert(titleBody.accepts?.[0]?.payTo === PRIMA_PAY_TO, "prima_title body payTo stays GtAk");

    fetchCalls = [];
    const chat = await worker.fetch(
      new Request("https://mcp.jettoptics.ai/x402/v1/chat", { method: "POST", body: "{}" }),
      env,
      ctx,
    );
    assert(chat.status === 200, `chat still proxies, got ${chat.status}`);
    assert(
      fetchCalls.some((c) => c.url.startsWith(`${AARON_ORIGIN}/x402/v1/chat`)),
      "chat still proxies to origin / 5ct4 faucet path",
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
    const apexStore = await worker.fetch(
      new Request(`https://jettoptics.ai${AGENC_STORE_PATH}`),
      env,
      ctx,
    );
    assert(apexStore.status === 404, `do not add apex /.well-known/agenc-store.json, got ${apexStore.status}`);
    assert(
      fetchCalls.filter((c) => c.url.includes("/.well-known/agenc-store.json")).length === 0,
      "apex agenc-store must not be invented or proxied",
    );

    fetchCalls = [];
    const apexX402 = await worker.fetch(new Request("https://jettoptics.ai/.well-known/x402"), env, ctx);
    assert(apexX402.status === 404, `do not add apex /.well-known/x402, got ${apexX402.status}`);
  } finally {
    restoreFetch();
  }
}

run()
  .then(() => {
    console.log(
      "ok: GET /.well-known/agenc-store.json is unauth 200 unsigned JSON; listings []; dest GtAk; agent-card untouched",
    );
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
