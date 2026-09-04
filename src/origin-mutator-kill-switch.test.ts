/**
 * Emergency edge kill-switch: CRITICAL leftover unauth aaron mutators
 * (totp enroll fire) return 401 {error:"unauthorized — temporarily disabled"}
 * and never proxy to AARON_ORIGIN. Login bootstrap (/session,
 * /jett/totp/challenge, /jett/challenge/create) is not stolen.
 * x402 catalog stays 200 payTo 5ct4. No prima_title. No Stripe. No jtx.chat 301.
 *
 * Run: npm test
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./index";
import { isAaronPath, isJoeHedgehogPath } from "./aaron-gateway";
import { isFaucetKillSwitchPath } from "./faucet-kill-switch";
import { isHedgehogPath } from "./hedgehog-mcp";
import type { GatewayEnv } from "./lib/cors";
import {
  ORIGIN_MUTATOR_DISABLED_ERROR,
  isLoginBootstrapPath,
  isOriginMutatorKillSwitchPath,
} from "./origin-mutator-kill-switch";
import { FAUCET_PAY_TO, buildX402Catalog, isX402CatalogPath } from "./x402-catalog";

const AARON_ORIGIN = "https://aaron.example.test";
const HEDGEHOG_ORIGIN = "https://hedgehog.example.test";
const JOE_TOKEN = "test-joe-token";
const AARON_HOST = "https://aaron.jettoptics.ai";
const MCP_HOST = "https://mcp.jettoptics.ai";

/** Canonical doors (no slash). Tests also cover the trailing-slash twin. */
const MUTATOR_BASE_PATHS = [
  "/jett/totp/enroll",
  "/jett/totp/verify",
  "/gaze/analyze",
  "/poa/claim",
  "/donations/claim",
  "/handshake/start",
  "/handshake/done",
  "/hermesync/pair",
  "/jett/challenge/scanned",
  "/orphan/claim",
  "/audit/devnet",
] as const;

const MUTATOR_PATHS = MUTATOR_BASE_PATHS.flatMap((p) => [p, `${p}/`]);

const WRANGLER_MUTATOR_ROUTES = [
  "aaron.jettoptics.ai/jett/totp/enroll*",
  "aaron.jettoptics.ai/jett/totp/verify*",
  "aaron.jettoptics.ai/gaze/analyze*",
  "aaron.jettoptics.ai/poa/claim*",
  "aaron.jettoptics.ai/donations/claim*",
  "aaron.jettoptics.ai/handshake/start*",
  "aaron.jettoptics.ai/handshake/done*",
  "aaron.jettoptics.ai/hermesync/pair*",
  "aaron.jettoptics.ai/jett/challenge/scanned*",
  "aaron.jettoptics.ai/orphan/claim*",
  "aaron.jettoptics.ai/audit/devnet*",
] as const;

const BOOTSTRAP_PATHS = [
  "/session",
  "/jett/totp/challenge",
  "/jett/totp/challenge/",
  "/jett/challenge/create",
  "/jett/challenge/create/",
] as const;

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
      return new Response(JSON.stringify({ secret: "LEAKED_TOTP", source: "aaron-origin-UNAUTH" }), {
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

async function assertKillSwitch(host: string, path: string, method: string): Promise<void> {
  const before = fetchCalls.length;
  const res = await worker.fetch(new Request(`${host}${path}`, { method }), env, ctx);
  assert(res.status === 401, `${method} ${host}${path} → 401, got ${res.status}`);
  assert(res.status !== 200, `${method} ${host}${path} must never 200 with a TOTP secret`);
  assert(res.status !== 301 && res.status !== 302, `${method} ${host}${path} must not redirect`);
  const loc = res.headers.get("Location") ?? "";
  assert(!loc.includes("jtx.chat"), `${method} ${host}${path} must not 301 to jtx.chat`);
  assert(res.headers.get("Cache-Control") === "no-store", `${method} ${path} Cache-Control no-store`);
  const body = (await res.json()) as { error?: string; secret?: unknown };
  assert(
    body.error === ORIGIN_MUTATOR_DISABLED_ERROR,
    `${method} ${path} error must be ${JSON.stringify(ORIGIN_MUTATOR_DISABLED_ERROR)}, got ${JSON.stringify(body.error)}`,
  );
  assert(body.secret === undefined, `${method} ${path} must not return a TOTP secret`);
  assert(fetchCalls.length === before, `${method} ${path} must NOT proxy to AARON_ORIGIN (calls=${fetchCalls.length})`);
}

async function run(): Promise<void> {
  for (const path of MUTATOR_PATHS) {
    assert(isOriginMutatorKillSwitchPath(path) === true, `exact ${path} is a kill path`);
    assert(isLoginBootstrapPath(path) === false, `${path} is not login bootstrap`);
    assert(isFaucetKillSwitchPath(path) === false, `${path} is not the faucet kill-switch`);
    assert(isHedgehogPath(path) === false, `${path} is not hedgehog`);
    assert(isJoeHedgehogPath(path) === false, `${path} is not /joe/hedgehog`);
  }

  assert(isOriginMutatorKillSwitchPath("/jett/totp/enroll/extra") === false, "prefix enroll/extra is not stolen");
  assert(isOriginMutatorKillSwitchPath("/gaze/analyze/extra") === false, "prefix gaze/analyze/extra is not stolen");
  assert(isOriginMutatorKillSwitchPath("/handshake") === false, "/handshake itself is not stolen");
  assert(isOriginMutatorKillSwitchPath("/handshake/") === false, "/handshake/ is not stolen");
  assert(isOriginMutatorKillSwitchPath("/gaze") === false, "/gaze itself is not stolen");
  assert(isOriginMutatorKillSwitchPath("/orphan") === false, "/orphan itself is not stolen");
  assert(isOriginMutatorKillSwitchPath("/orphan/402") === false, "/orphan/402 stays origin-proxied");
  assert(isOriginMutatorKillSwitchPath("/x402/v1/gaze/analyze") === false, "x402 gaze SKU is not stolen");

  for (const path of BOOTSTRAP_PATHS) {
    assert(isOriginMutatorKillSwitchPath(path) === false, `${path} must not be edge-blocked`);
    assert(isLoginBootstrapPath(path) === true, `${path} is login bootstrap`);
  }

  assert(isAaronPath("/session") === true, "/session stays an AARON_PATH (proxied ungated)");
  assert(isAaronPath("/gaze/analyze") === true, "/gaze/analyze is under AARON_PATHS prefix — kill-switch must win first");
  assert(isAaronPath("/handshake/start") === true, "/handshake/start is under AARON_PATHS prefix — kill-switch must win first");
  assert(isAaronPath("/orphan/claim") === true, "/orphan/claim is under AARON_PATHS prefix — kill-switch must win first");

  const catalog = buildX402Catalog();
  assert(catalog.payTo === FAUCET_PAY_TO, "payTo must stay 5ct4 faucet");
  assert(catalog.payTo.startsWith("5ct4"), `payTo must start 5ct4, got ${catalog.payTo}`);
  assert(!catalog.services.some((s) => s.id === "prima_title"), "prima_title must stay gone");
  assert(isX402CatalogPath("/x402") === true, "GET /x402 stays the catalog path");

  const wranglerPath = join(dirname(fileURLToPath(import.meta.url)), "..", "wrangler.toml");
  const wrangler = readFileSync(wranglerPath, "utf8");
  const routePatterns = [...wrangler.matchAll(/^\s*pattern\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
  for (const pattern of WRANGLER_MUTATOR_ROUTES) {
    assert(routePatterns.includes(pattern), `wrangler attaches ${pattern}`);
  }
  assert(
    !routePatterns.some((p) => p === "aaron.jettoptics.ai/*" || p === "aaron.jettoptics.ai"),
    "must not steal the whole aaron host",
  );
  assert(!routePatterns.includes("aaron.jettoptics.ai/session"), "must not attach /session");
  assert(!routePatterns.includes("aaron.jettoptics.ai/session*"), "must not attach /session*");
  assert(!routePatterns.includes("aaron.jettoptics.ai/jett/totp/challenge*"), "must not attach totp challenge");
  assert(!routePatterns.includes("aaron.jettoptics.ai/jett/totp/challenge"), "must not attach totp challenge exact");
  assert(!routePatterns.includes("aaron.jettoptics.ai/jett/challenge/create*"), "must not attach challenge create");
  assert(!routePatterns.includes("aaron.jettoptics.ai/jett/challenge/create"), "must not attach challenge create exact");
  assert(!routePatterns.includes("aaron.jettoptics.ai/jett/*"), "must not steal all /jett/*");
  assert(!routePatterns.includes("aaron.jettoptics.ai/gaze*"), "must not steal all /gaze*");
  assert(!routePatterns.includes("aaron.jettoptics.ai/handshake*"), "must not steal all /handshake*");
  assert(!routePatterns.includes("aaron.jettoptics.ai/orphan*"), "must not steal all /orphan*");
  assert(!routePatterns.some((p) => p.includes("jtx.chat")), "no leftover jtx.chat DNS / route");
  assert(!routePatterns.some((p) => p.toLowerCase().includes("custom_domain")), "no leftover custom_domain DNS");
  assert(!wrangler.toLowerCase().includes("stripe"), "wrangler must not add Stripe");

  installFetchMock();
  try {
    for (const host of [AARON_HOST, MCP_HOST]) {
      for (const path of MUTATOR_PATHS) {
        await assertKillSwitch(host, path, "POST");
        await assertKillSwitch(host, path, "GET");
      }
    }

    const authedEnroll = await worker.fetch(
      new Request(`${AARON_HOST}/jett/totp/enroll`, {
        method: "POST",
        headers: { Authorization: `Bearer ${JOE_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      env,
      ctx,
    );
    assert(authedEnroll.status === 401, `JOE token must not bypass totp enroll kill-switch, got ${authedEnroll.status}`);
    const authedBody = (await authedEnroll.json()) as { error?: string; secret?: unknown };
    assert(authedBody.error === ORIGIN_MUTATOR_DISABLED_ERROR, "authed enroll still unauthorized");
    assert(authedBody.secret === undefined, "authed enroll must not return a TOTP secret");
    assert(fetchCalls.length === 0, "authed enroll must not proxy");

    const session = await worker.fetch(new Request(`${MCP_HOST}/session`, { method: "GET" }), env, ctx);
    assert(session.status === 200, `/session still proxied ungated, got ${session.status}`);
    assert(session.status !== 401, "/session must not be the mutator kill-switch");
    assert(
      fetchCalls.some((c) => c.url.startsWith(`${AARON_ORIGIN}/session`)),
      "/session still goes to AARON_ORIGIN (login bootstrap not stolen)",
    );

    const challengeCallsBefore = fetchCalls.length;
    for (const path of ["/jett/totp/challenge", "/jett/totp/challenge/", "/jett/challenge/create", "/jett/challenge/create/"]) {
      const res = await worker.fetch(new Request(`${MCP_HOST}${path}`, { method: "POST" }), env, ctx);
      assert(res.status !== 401, `POST ${path} must not be kill-switched, got ${res.status}`);
      const body = (await res.json()) as { error?: string };
      assert(body.error !== ORIGIN_MUTATOR_DISABLED_ERROR, `POST ${path} is not the mutator kill-switch`);
    }
    assert(
      fetchCalls.length === challengeCallsBefore,
      "challenge create/totp challenge are not AARON_PATHS — Worker 404, never proxied, never 401-killed",
    );

    const handshake = await worker.fetch(new Request(`${MCP_HOST}/handshake`, { method: "GET" }), env, ctx);
    assert(handshake.status === 200, `/handshake itself still proxied, got ${handshake.status}`);
    assert(
      fetchCalls.some((c) => c.url.startsWith(`${AARON_ORIGIN}/handshake`) && !c.url.includes("/handshake/start") && !c.url.includes("/handshake/done")),
      "/handshake still goes to AARON_ORIGIN",
    );

    const orphan402 = await worker.fetch(new Request(`${MCP_HOST}/orphan/402`, { method: "POST" }), env, ctx);
    assert(orphan402.status === 200, `/orphan/402 still proxied, got ${orphan402.status}`);
    assert(
      fetchCalls.some((c) => c.url.startsWith(`${AARON_ORIGIN}/orphan/402`)),
      "/orphan/402 still goes to AARON_ORIGIN (not stolen by /orphan/claim*)",
    );

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

    const oauthMeta = await worker.fetch(
      new Request(`${MCP_HOST}/.well-known/oauth-authorization-server`, { method: "GET" }),
      env,
      ctx,
    );
    assert(oauthMeta.status === 200, `hedgehog OAuth AS metadata still 200, got ${oauthMeta.status}`);
    assert(oauthMeta.status !== 301, "OAuth metadata must not 301");

    const hedgehogUnauth = await worker.fetch(new Request(`${MCP_HOST}/joe/hedgehog`, { method: "POST" }), env, ctx);
    assert(hedgehogUnauth.status === 401, `unauth /joe/hedgehog still 401, got ${hedgehogUnauth.status}`);
    const hedgehogBody = (await hedgehogUnauth.json()) as { error?: string };
    assert(hedgehogBody.error !== ORIGIN_MUTATOR_DISABLED_ERROR, "hedgehog 401 is not the mutator kill-switch");
  } finally {
    restoreFetch();
  }
}

run()
  .then(() => {
    console.log(
      "ok: origin mutators (totp enroll fire) → 401 no AARON_ORIGIN proxy; bootstrap /session + challenge left alone; x402 payTo 5ct4",
    );
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
