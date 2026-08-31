/**
 * Public unsigned agenc.storeManifest.v1 (AgenC verifier door).
 *
 * GET /.well-known/agenc-store.json — unauthenticated HTTP 200 application/json.
 * Body is the hosted claim copied exactly from
 * https://agenc.ag/@augment/agenc-store.json — do not invent bps, titles,
 * timestamps, or sha256. Custom porch JSON must not live on this path.
 *
 * Never 402. Never attach payTo or X-Pay-To headers. Not proxied. Not AARON_PATHS.
 * Not JOE-gated. Worker never signs and never holds a key. signature stays null.
 *
 * Do not put dest, payTo, GtAk, 5ct4, or astro.knots.sol in this v1 body.
 * GtAk stays LOAD dest elsewhere (prima_title / swarm), not the store claim.
 *
 * Served on mcp.jettoptics.ai and aaron.jettoptics.ai only. Not apex jettoptics.ai.
 * Does not overwrite /.well-known/agent-card.json.
 */

import type { GatewayEnv } from "./lib/cors";
import { getCorsHeaders, jsonResponse } from "./lib/cors";

export const AGENC_STORE_PATH = "/.well-known/agenc-store.json";

/** Hosted claim source. Do not rewrite fields from this URL. */
export const AGENC_HOSTED_CLAIM_URL = "https://agenc.ag/@augment/agenc-store.json";

export const AGENC_STORE_SCHEMA = "agenc.storeManifest.v1";
export const AGENC_HANDLE = "augment";
export const AGENC_TITLE = "Jett Optics";

/** AgenC operator / wallet (public-only). Same DQbS as prima_title wallet. */
export const AGENC_WALLET = "DQbSfPspQS2JW2EqrZcFF5KgaYZBruFJxmwhSzvTkuMU";

/** Copied from hosted claim — do not invent. */
export const AGENC_OPERATOR_FEE_BPS = 1000;
export const AGENC_REFERRER_FEE_BPS = 500;
export const AGENC_UPDATED_AT = 1787030092;
export const AGENC_SIGNING_SHA256 =
  "be2f721d009d547877980a25bcf6799528608f9e8a9486fac6b1002b880c0159";

/**
 * Exact bytes of https://agenc.ag/@augment/agenc-store.json.
 * Do not reword, pretty-print, or add dest/payTo/listings. Worker never signs.
 */
export const AGENC_STORE_BODY =
  '{"body":{"agents":[],"handle":"augment","operator":"DQbSfPspQS2JW2EqrZcFF5KgaYZBruFJxmwhSzvTkuMU","operatorFeeBps":1000,"origin":"","referrerFeeBps":500,"schema":"agenc.storeManifest.v1","title":"Jett Optics","updatedAt":1787030092,"wallet":"DQbSfPspQS2JW2EqrZcFF5KgaYZBruFJxmwhSzvTkuMU"},"wallet":"DQbSfPspQS2JW2EqrZcFF5KgaYZBruFJxmwhSzvTkuMU","signature":null,"status":"unsigned","signing":{"sha256":"be2f721d009d547877980a25bcf6799528608f9e8a9486fac6b1002b880c0159","message":"agenc store manifest v1\\nsha256: be2f721d009d547877980a25bcf6799528608f9e8a9486fac6b1002b880c0159"}}';

export function isAgencStorePath(pathname: string): boolean {
  return pathname === AGENC_STORE_PATH || pathname === `${AGENC_STORE_PATH}/`;
}

/** Apex jettoptics.ai must not serve this document. */
export function isApexJettopticsHost(hostname: string): boolean {
  return hostname === "jettoptics.ai" || hostname === "www.jettoptics.ai";
}

function storeHeaders(cors: Headers, requestId: string): Headers {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json");
  headers.set("X-Request-ID", requestId);
  headers.delete("X-Pay-To");
  headers.delete("X-Pay-To-Domain");
  headers.delete("X-Payment-Required");
  headers.delete("payTo");
  return headers;
}

export function handleAgencStore(
  request: Request,
  env: GatewayEnv,
  requestId: string,
): Response {
  const cors = getCorsHeaders(request, env);
  const hostname = new URL(request.url).hostname;

  if (isApexJettopticsHost(hostname)) {
    return jsonResponse(
      {
        error: "Not found",
        gateway: "jettoptx-aaron-hedgehog",
        requestId,
      },
      404,
      cors,
      requestId,
    );
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    cors.set("Allow", "GET, HEAD");
    return jsonResponse({ error: "Method not allowed", requestId }, 405, cors, requestId);
  }

  const headers = storeHeaders(cors, requestId);
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(AGENC_STORE_BODY, { status: 200, headers });
}
