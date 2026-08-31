/**
 * Proves GET /.well-known/agenc-store.json is unsigned agenc.storeManifest.v1
 * copied from https://agenc.ag/@augment/agenc-store.json. Never 402.
 * Never dest/payTo/GtAk in this body. Never payTo / X-Pay-To header.
 * GET /.well-known/agent-card.json stays origin-proxied. Apex jettoptics.ai 404s.
 * GET /x402/prima_title stays 402 to GtAk. Faucet 5ct4 services stay proxied.
 *
 * Run: npm test
 */
import worker from "./index";
import { isAaronPath } from "./aaron-gateway";
import type { GatewayEnv } from "./lib/cors";
import {
  AGENC_HANDLE,
  AGENC_OPERATOR_FEE_BPS,
  AGENC_REFERRER_FEE_BPS,
  AGENC_SIGNING_SHA256,
  AGENC_STORE_BODY,
  AGENC_STORE_PATH,
  AGENC_STORE_SCHEMA,
  AGENC_TITLE,
  AGENC_UPDATED_AT,
  AGENC_WALLET,
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

  assert(!AGENC_STORE_BODY.includes("dest"), "v1 body must not contain dest");
  assert(!AGENC_STORE_BODY.includes("payTo"), "v1 body must not contain payTo");
  assert(!AGENC_STORE_BODY.includes("GtAk"), "v1 body must not contain GtAk");
  assert(!AGENC_STORE_BODY.includes("5ct4"), "v1 body must not contain 5ct4");
  assert(!AGENC_STORE_BODY.includes("astro.knots.sol"), "v1 body must not contain astro.knots.sol");
  assert(!AGENC_STORE_BODY.includes("listings"), "v1 body is not custom porch listings JSON");
  assert(!AGENC_STORE_BODY.includes("shop"), "v1 body is not custom porch shop JSON");

  const parsed = JSON.parse(AGENC_STORE_BODY) as {
    body?: {
      agents?: unknown;
      handle?: string;
      operator?: string;
      operatorFeeBps?: number;
      origin?: string;
      referrerFeeBps?: number;
      schema?: string;
      title?: string;
      updatedAt?: number;
      wallet?: string;
      dest?: unknown;
      payTo?: unknown;
    };
    wallet?: string;
    signature?: unknown;
    status?: string;
    signing?: { sha256?: string; message?: string };
    dest?: unknown;
    payTo?: unknown;
  };
  const keys = Object.keys(parsed);
  assert(keys.join(",") === "body,wallet,signature,status,signing", `envelope keys ${keys.join(",")}`);
  const bodyKeys = Object.keys(parsed.body ?? {});
  assert(
    bodyKeys.join(",") ===
      "agents,handle,operator,operatorFeeBps,origin,referrerFeeBps,schema,title,updatedAt,wallet",
    `body keys ${bodyKeys.join(",")}`,
  );
  assert(parsed.body?.schema === AGENC_STORE_SCHEMA, "schema agenc.storeManifest.v1");
  assert(parsed.body?.handle === AGENC_HANDLE, "handle augment");
  assert(parsed.body?.title === AGENC_TITLE, "title Jett Optics (copied)");
  assert(parsed.body?.operator === AGENC_WALLET, "operator DQbS");
  assert(parsed.body?.wallet === AGENC_WALLET, "body.wallet DQbS");
  assert(parsed.wallet === AGENC_WALLET, "envelope wallet DQbS");
  assert(parsed.wallet === PRIMA_TITLE_WALLET, "wallet matches public DQbS");
  assert(parsed.body?.operator === PRIMA_TITLE_WALLET, "operator matches public DQbS");
  assert(Array.isArray(parsed.body?.agents) && parsed.body?.agents.length === 0, "agents []");
  assert(parsed.body?.operatorFeeBps === AGENC_OPERATOR_FEE_BPS, "operatorFeeBps 1000 copied");
  assert(parsed.body?.referrerFeeBps === AGENC_REFERRER_FEE_BPS, "referrerFeeBps 500 copied");
  assert(parsed.body?.operatorFeeBps === 1000, "operatorFeeBps is 1000");
  assert(parsed.body?.referrerFeeBps === 500, "referrerFeeBps is 500");
  assert(parsed.body?.origin === "", "origin empty (hosted claim)");
  assert(parsed.body?.updatedAt === AGENC_UPDATED_AT, "updatedAt copied not invented");
  assert(parsed.signature === null, "signature null (unsigned; Worker never signs)");
  assert(parsed.status === "unsigned", "status unsigned");
  assert(parsed.signing?.sha256 === AGENC_SIGNING_SHA256, "signing sha256 copied");
  assert(
    parsed.signing?.message === `agenc store manifest v1\nsha256: ${AGENC_SIGNING_SHA256}`,
    "signing message copied",
  );
  assert(!("dest" in parsed) && !("payTo" in parsed), "envelope must not have dest/payTo");
  assert(
    parsed.body !== undefined && !("dest" in parsed.body) && !("payTo" in parsed.body),
    "manifest body must not have dest/payTo",
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
      assert(!raw.includes("dest") && !raw.includes("payTo"), `${host} response has no dest/payTo`);
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
      "ok: GET /.well-known/agenc-store.json is unsigned agenc.storeManifest.v1; no dest/payTo; agent-card untouched",
    );
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
