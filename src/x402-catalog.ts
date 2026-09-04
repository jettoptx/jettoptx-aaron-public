/**
 * Edge GET /x402 catalog. Faucet payTo only (5ct4 / jtxfaucet.sol).
 * prima_title removed (Josh 2026-09-03).
 */

import type { GatewayEnv } from "./lib/cors";
import { getCorsHeaders, jsonResponse } from "./lib/cors";

export const FAUCET_PAY_TO = "5ct4GDdvNV4GLEgQ595yegWH5Eyrp2hBGuabz2ZyCbyc";
export const FAUCET_PAY_TO_DOMAIN = "jtxfaucet.sol";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const AARON_PUBLIC_BASE = "https://aaron.jettoptics.ai";

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
    services: [...EXISTING_X402_SERVICES],
    auth: {
      headers: ["X-PAYMENT", "PAYMENT-SIGNATURE", "x-payment"],
      bodyFields: ["tx", "signature", "tx_signature"],
    },
  };
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
