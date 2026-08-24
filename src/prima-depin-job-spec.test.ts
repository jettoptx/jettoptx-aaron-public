/**
 * Proves GET /specs/prima-depin-job.json is an unauthenticated 200 JSON door
 * with the exact marketplace jobSpec body. Never 402. Never payTo / X-Pay-To.
 * GET /x402/prima_title stays 402 to GtAk. Faucet 5ct4 services stay proxied.
 *
 * Run: npm test
 */
import worker from "./index";
import { isAaronPath } from "./aaron-gateway";
import type { GatewayEnv } from "./lib/cors";
import {
  PRIMA_DEPIN_JOB_SPEC_BODY,
  PRIMA_DEPIN_JOB_SPEC_PATH,
  isPrimaDepinJobSpecPath,
} from "./prima-depin-job-spec";
import { FAUCET_PAY_TO, PRIMA_PAY_TO, isPrimaTitlePath } from "./x402-prima-title";

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
  assert(isPrimaDepinJobSpecPath(PRIMA_DEPIN_JOB_SPEC_PATH) === true, "exact job spec path");
  assert(isPrimaDepinJobSpecPath(`${PRIMA_DEPIN_JOB_SPEC_PATH}/`) === true, "trailing slash job spec");
  assert(isPrimaDepinJobSpecPath("/specs") === false, "/specs is not the job spec");
  assert(isPrimaDepinJobSpecPath("/x402/prima_title") === false, "title is not the job spec");
  assert(isPrimaTitlePath(PRIMA_DEPIN_JOB_SPEC_PATH) === false, "job spec is not prima_title");
  assert(isAaronPath(PRIMA_DEPIN_JOB_SPEC_PATH) === false, "job spec is not in AARON_PATHS");

  const parsed = JSON.parse(PRIMA_DEPIN_JOB_SPEC_BODY) as {
    kind?: string;
    title?: string;
    description?: string;
  };
  const keys = Object.keys(parsed);
  assert(keys.join(",") === "kind,title,description", `job spec keys ${keys.join(",")}`);
  assert(parsed.kind === "agenc.marketplace.jobSpec", "kind");
  assert(parsed.title === "Prima DEPIN research + legal setup", "title");
  assert(
    parsed.description?.includes("Do not invent URLs, prices, or emails") === true,
    "description keeps the no-invent lock",
  );
  assert(parsed.description?.includes("5ct4") === true, "description keeps the 5ct4 lock");
  assert(
    !("payTo" in parsed) && !("url" in parsed) && !("email" in parsed) && !("price" in parsed),
    "job spec must not grow extra fields",
  );

  installFetchMock();
  try {
    for (const host of ["https://aaron.jettoptics.ai", "https://mcp.jettoptics.ai"]) {
      const unauth = await worker.fetch(new Request(`${host}${PRIMA_DEPIN_JOB_SPEC_PATH}`), env, ctx);
      assert(unauth.status === 200, `${host} unauth GET must 200, got ${unauth.status}`);
      assert(unauth.status !== 402, `${host} unauth GET must never 402`);
      assert(unauth.status !== 401, `${host} unauth GET must never 401`);
      assert(
        unauth.headers.get("Content-Type") === "application/json",
        `${host} Content-Type application/json, got ${unauth.headers.get("Content-Type")}`,
      );
      assertNoPayHeaders(unauth, host);
      const raw = await unauth.text();
      assert(raw === PRIMA_DEPIN_JOB_SPEC_BODY, `${host} body must be byte-for-byte exact`);
    }

    const originHits = fetchCalls.filter((c) => c.url.startsWith(AARON_ORIGIN));
    assert(originHits.length === 0, `job spec must not proxy, got ${JSON.stringify(originHits)}`);

    fetchCalls = [];
    const withToken = await worker.fetch(
      new Request(`https://aaron.jettoptics.ai${PRIMA_DEPIN_JOB_SPEC_PATH}`, {
        headers: { Authorization: "Bearer unused", "X-JOE-Token": "unused" },
      }),
      env,
      ctx,
    );
    assert(withToken.status === 200, "token present still 200 (door is public, not gated)");
    assert((await withToken.text()) === PRIMA_DEPIN_JOB_SPEC_BODY, "token does not change body");
    assertNoPayHeaders(withToken, "tokened GET");

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
    const apex = await worker.fetch(new Request("https://jettoptics.ai/.well-known/x402"), env, ctx);
    assert(apex.status === 404, `do not add apex /.well-known/x402, got ${apex.status}`);
    assert(
      fetchCalls.filter((c) => c.url.includes("/.well-known/x402")).length === 0,
      "apex well-known/x402 must not be invented",
    );
  } finally {
    restoreFetch();
  }
}

run()
  .then(() => {
    console.log(
      "ok: GET /specs/prima-depin-job.json is unauth 200 exact JSON; prima_title still 402s to GtAk",
    );
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
