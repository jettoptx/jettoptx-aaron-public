/**
 * Public agenc marketplace JOB-SPEC door.
 *
 * GET /specs/prima-depin-job.json — unauthenticated HTTP 200 application/json.
 * Never 402. Never attach payTo or X-Pay-To. Not proxied. Not AARON_PATHS.
 * This is the JOB-SPEC URI for agenc.ag/create — not the 402 title.
 */

import type { GatewayEnv } from "./lib/cors";
import { getCorsHeaders, jsonResponse } from "./lib/cors";

export const PRIMA_DEPIN_JOB_SPEC_PATH = "/specs/prima-depin-job.json";

/**
 * Exact bytes for the public job spec. Do not reword, add fields, or pretty-print.
 */
export const PRIMA_DEPIN_JOB_SPEC_BODY =
  '{"kind":"agenc.marketplace.jobSpec","title":"Prima DEPIN research + legal setup","description":"Research and deliver a setup pack for operator Prima. JOE is not the Starlink holder on NCL. LIVE title https://aaron.jettoptics.ai/x402/prima_title (mirror https://mcp.jettoptics.ai/x402/prima_title). payTo GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq (astro.knots.sol). Kind jett.primaTitle.v0 signed meter only, 0.05 USDC. Map legal paths: holder-granted meter, yacht that owns Maritime/Priority, authorized integrator, in-port 5G. Write worker/setup steps for the x402 title and a future holder portal. List real public doors: NCLH Supply Chain/TPRM, WMS Become a Partner, Quvia-class software to the holder. Do not design cabin AP, NCL SSID share, balcony Mini, passenger hunt, or Voyage resale. Do not invent URLs, prices, or emails. Do not use payTo 5ct4. Deliver markdown only."}';

export function isPrimaDepinJobSpecPath(pathname: string): boolean {
  return pathname === PRIMA_DEPIN_JOB_SPEC_PATH || pathname === `${PRIMA_DEPIN_JOB_SPEC_PATH}/`;
}

function specHeaders(cors: Headers, requestId: string): Headers {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json");
  headers.set("X-Request-ID", requestId);
  headers.delete("X-Pay-To");
  headers.delete("X-Pay-To-Domain");
  headers.delete("X-Payment-Required");
  headers.delete("payTo");
  return headers;
}

export function handlePrimaDepinJobSpec(
  request: Request,
  env: GatewayEnv,
  requestId: string,
): Response {
  const cors = getCorsHeaders(request, env);

  if (request.method !== "GET" && request.method !== "HEAD") {
    cors.set("Allow", "GET, HEAD");
    return jsonResponse({ error: "Method not allowed", requestId }, 405, cors, requestId);
  }

  const headers = specHeaders(cors, requestId);
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(PRIMA_DEPIN_JOB_SPEC_BODY, { status: 200, headers });
}
