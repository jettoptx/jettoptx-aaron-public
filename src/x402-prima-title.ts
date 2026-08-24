/**
 * Edge x402 doors that cannot 404 through origin:
 *   GET /x402              — catalog (existing four services + prima_title)
 *   GET /x402/prima_title  — 402 challenge; settle returns jett.primaTitle.v0
 *
 * prima_title payTo is GtAk (astro.knots.sol) ONLY.
 * chat / gaze_analyze / task / orphan_donate and the faucet stay 5ct4 (jtxfaucet.sol).
 * Reused listed amount: task priceUsdc 0.05 / priceAtomic 50000.
 */

import type { GatewayEnv } from "./lib/cors";
import { getCorsHeaders, jsonResponse } from "./lib/cors";

/** Faucet / existing services. Never use this as prima_title payTo. */
export const FAUCET_PAY_TO = "5ct4GDdvNV4GLEgQ595yegWH5Eyrp2hBGuabz2ZyCbyc";
export const FAUCET_PAY_TO_DOMAIN = "jtxfaucet.sol";

/** prima_title dest only (astro.knots.sol). */
export const PRIMA_PAY_TO = "GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq";
export const PRIMA_PAY_TO_DOMAIN = "astro.knots.sol";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const PRIMA_TITLE_KIND = "jett.primaTitle.v0";
export const PRIMA_OPERATOR = "Prima";
export const PRIMA_HANDLE = "augment";
export const PRIMA_TITLE_WALLET = "DQbSfPspQS2JW2EqrZcFF5KgaYZBruFJxmwhSzvTkuMU";

/** Reused from live catalog service `task` — do not invent a price. */
export const PRIMA_PRICE_USDC = 0.05;
export const PRIMA_PRICE_ATOMIC = 50000;
export const PRIMA_PRICE_ATOMIC_STR = "50000";

export const PRIMA_TITLE_PATH = "/x402/prima_title";
export const AARON_PUBLIC_BASE = "https://aaron.jettoptics.ai";
export const PRIMA_RESOURCE_URL = `${AARON_PUBLIC_BASE}${PRIMA_TITLE_PATH}`;

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

export const EXISTING_X402_SERVICES = [
  {
    id: "chat",
    method: "POST",
    path: "/x402/v1/chat",
    description: "JOE harness chat completion (HEDGEHOG / Hermes)",
    priceUsdc: 0.01,
    priceAtomic: 10000,
  },
  {
    id: "gaze_analyze",
    method: "POST",
    path: "/x402/v1/gaze/analyze",
    description: "AGT gaze tensor classification",
    priceUsdc: 0.005,
    priceAtomic: 5000,
  },
  {
    id: "task",
    method: "POST",
    path: "/x402/v1/task",
    description: "JOE async task / swarm kickoff",
    priceUsdc: 0.05,
    priceAtomic: 50000,
  },
  {
    id: "orphan_donate",
    method: "POST",
    path: "/orphan/402",
    description: "Orphaned Agent Fund USDC contribution envelope",
    priceUsdc: 1.0,
    priceAtomic: 1000000,
  },
] as const;

export const PRIMA_TITLE_SERVICE = {
  id: "prima_title",
  method: "GET",
  path: PRIMA_TITLE_PATH,
  description:
    "Signed Prima meter/title (jett.primaTitle.v0). Does not grant NCL Voyage minutes, Starlink bytes, boat SSID, or passenger location.",
  priceUsdc: PRIMA_PRICE_USDC,
  priceAtomic: PRIMA_PRICE_ATOMIC,
  dest: PRIMA_PAY_TO,
  payTo: PRIMA_PAY_TO,
  payToDomain: PRIMA_PAY_TO_DOMAIN,
} as const;

export function isPrimaTitlePath(pathname: string): boolean {
  return pathname === PRIMA_TITLE_PATH || pathname === `${PRIMA_TITLE_PATH}/`;
}

export function isX402CatalogPath(pathname: string): boolean {
  return pathname === "/x402" || pathname === "/x402/";
}

export function buildX402Catalog() {
  return {
    protocol: "x402",
    version: "1.0.0",
    network: "solana",
    asset: USDC_MINT,
    payTo: FAUCET_PAY_TO,
    payToDomain: FAUCET_PAY_TO_DOMAIN,
    baseUrl: AARON_PUBLIC_BASE,
    agentCard: `${AARON_PUBLIC_BASE}/.well-known/agent-card.json`,
    services: [...EXISTING_X402_SERVICES, PRIMA_TITLE_SERVICE],
    auth: {
      headers: ["X-PAYMENT", "PAYMENT-SIGNATURE", "x-payment"],
      bodyFields: ["tx", "signature", "tx_signature"],
    },
  };
}

function assertPrimaPayToIsNotFaucet(payTo: string): void {
  if (payTo === FAUCET_PAY_TO) {
    throw new Error("prima_title payTo must not be the faucet");
  }
}

export function buildPrimaTitleChallenge() {
  assertPrimaPayToIsNotFaucet(PRIMA_PAY_TO);
  return {
    x402Version: 1,
    error: "Payment required to access this resource",
    accepts: [
      {
        scheme: "exact",
        network: "solana",
        maxAmountRequired: PRIMA_PRICE_ATOMIC_STR,
        asset: USDC_MINT,
        payTo: PRIMA_PAY_TO,
        resource: PRIMA_RESOURCE_URL,
        description: "Prima signed meter/title (jett.primaTitle.v0)",
        mimeType: "application/json",
        maxTimeoutSeconds: 120,
        extra: {
          name: "JOE — Jett Optics Engine",
          payToDomain: PRIMA_PAY_TO_DOMAIN,
          tokenSymbol: "USDC",
          decimals: 6,
          facilitator: null,
          verifyMode: "onchain-rpc",
        },
      },
    ],
  };
}

function challengeHeaders(cors: Headers): Headers {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Pay-To", PRIMA_PAY_TO);
  headers.set("X-Pay-To-Domain", PRIMA_PAY_TO_DOMAIN);
  headers.set("X-Payment-Required", "x402");
  return headers;
}

function paymentRequiredResponse(cors: Headers, requestId: string): Response {
  const headers = challengeHeaders(cors);
  headers.set("X-Request-ID", requestId);
  return new Response(JSON.stringify(buildPrimaTitleChallenge()), {
    status: 402,
    headers,
  });
}

function rpcUrl(env: GatewayEnv): string {
  return env.HELIUS_MAINNET_RPC?.trim() || DEFAULT_RPC;
}

function headerPaymentRaw(request: Request): string {
  return (
    request.headers.get("X-PAYMENT")?.trim() ||
    request.headers.get("PAYMENT-SIGNATURE")?.trim() ||
    request.headers.get("x-payment")?.trim() ||
    ""
  );
}

function decodeBase64Json(raw: string): unknown {
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const json = atob(normalized + pad);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function looksLikeSignature(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(value);
}

function collectPaymentCandidates(raw: unknown, into: string[]): void {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (looksLikeSignature(trimmed)) into.push(trimmed);
    const decoded = decodeBase64Json(trimmed);
    if (decoded && decoded !== raw) collectPaymentCandidates(decoded, into);
    return;
  }
  if (!raw || typeof raw !== "object") return;
  const obj = raw as Record<string, unknown>;
  for (const key of ["signature", "tx_signature", "tx", "transaction"]) {
    const value = obj[key];
    if (typeof value === "string") collectPaymentCandidates(value, into);
  }
  if (obj.payload) collectPaymentCandidates(obj.payload, into);
}

async function readBodyCandidates(request: Request): Promise<string[]> {
  const out: string[] = [];
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json") && request.method === "GET") {
    return out;
  }
  try {
    const clone = request.clone();
    const text = await clone.text();
    if (!text.trim()) return out;
    try {
      collectPaymentCandidates(JSON.parse(text), out);
    } catch {
      collectPaymentCandidates(text, out);
    }
  } catch {
    /* no body */
  }
  return out;
}

async function extractPaymentSignatures(request: Request): Promise<string[]> {
  const found: string[] = [];
  const headerRaw = headerPaymentRaw(request);
  if (headerRaw) collectPaymentCandidates(headerRaw, found);
  const bodyFound = await readBodyCandidates(request);
  found.push(...bodyFound);
  return [...new Set(found)];
}

interface TokenBalance {
  mint?: string;
  owner?: string;
  uiTokenAmount?: { amount?: string };
}

function tokenDeltaToPrima(pre: TokenBalance[] | undefined, post: TokenBalance[] | undefined): bigint {
  const before = new Map<string, bigint>();
  for (const row of pre ?? []) {
    if (row.mint !== USDC_MINT || row.owner !== PRIMA_PAY_TO) continue;
    before.set(row.owner, BigInt(row.uiTokenAmount?.amount || "0"));
  }
  let delta = 0n;
  for (const row of post ?? []) {
    if (row.mint !== USDC_MINT || row.owner !== PRIMA_PAY_TO) continue;
    const after = BigInt(row.uiTokenAmount?.amount || "0");
    const prev = before.get(row.owner) ?? 0n;
    if (after > prev) delta += after - prev;
  }
  return delta;
}

async function verifyUsdcSettle(signature: string, env: GatewayEnv): Promise<boolean> {
  try {
    const res = await fetch(rpcUrl(env), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "prima-title-settle",
        method: "getTransaction",
        params: [
          signature,
          {
            encoding: "jsonParsed",
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          },
        ],
      }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      result?: {
        meta?: {
          err?: unknown;
          preTokenBalances?: TokenBalance[];
          postTokenBalances?: TokenBalance[];
        };
      };
    };
    const meta = data.result?.meta;
    if (!meta || meta.err) return false;
    return tokenDeltaToPrima(meta.preTokenBalances, meta.postTokenBalances) >= BigInt(PRIMA_PRICE_ATOMIC);
  } catch {
    return false;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildPrimaTitleMeter(paymentTx: string): Promise<Record<string, unknown>> {
  const issuedAt = new Date().toISOString();
  const body = {
    kind: PRIMA_TITLE_KIND,
    operator: PRIMA_OPERATOR,
    handle: PRIMA_HANDLE,
    wallet: PRIMA_TITLE_WALLET,
    meter: {
      resource: "prima_title",
      grants: [] as string[],
    },
    notGranted: [
      "ncl_voyage_minutes",
      "starlink_bytes",
      "boat_ssid",
      "passenger_location",
    ],
    payTo: PRIMA_PAY_TO,
    payToDomain: PRIMA_PAY_TO_DOMAIN,
    priceAtomic: PRIMA_PRICE_ATOMIC,
    paymentTx,
    issuedAt,
  };
  const digest = await sha256Hex(JSON.stringify(body));
  return { ...body, digest };
}

export async function handleX402Catalog(
  request: Request,
  env: GatewayEnv,
  requestId: string,
): Promise<Response> {
  const cors = getCorsHeaders(request, env);
  if (request.method !== "GET" && request.method !== "HEAD") {
    cors.set("Allow", "GET, HEAD");
    return jsonResponse({ error: "Method not allowed", requestId }, 405, cors, requestId);
  }
  const body = buildX402Catalog();
  if (request.method === "HEAD") {
    const headers = new Headers(cors);
    headers.set("Content-Type", "application/json");
    headers.set("X-Request-ID", requestId);
    return new Response(null, { status: 200, headers });
  }
  return jsonResponse(body, 200, cors, requestId);
}

export async function handlePrimaTitle(
  request: Request,
  env: GatewayEnv,
  requestId: string,
): Promise<Response> {
  const cors = getCorsHeaders(request, env);

  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "POST") {
    cors.set("Allow", "GET, HEAD, POST");
    return jsonResponse({ error: "Method not allowed", requestId }, 405, cors, requestId);
  }

  const signatures = await extractPaymentSignatures(request);
  for (const signature of signatures) {
    const ok = await verifyUsdcSettle(signature, env);
    if (!ok) continue;
    const title = await buildPrimaTitleMeter(signature);
    if (request.method === "HEAD") {
      const headers = new Headers(cors);
      headers.set("Content-Type", "application/json");
      headers.set("X-Request-ID", requestId);
      headers.set("Cache-Control", "no-store");
      return new Response(null, { status: 200, headers });
    }
    return jsonResponse(title, 200, cors, requestId);
  }

  return paymentRequiredResponse(cors, requestId);
}
