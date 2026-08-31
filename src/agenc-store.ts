/**
 * Public AgenC store document (unsigned).
 *
 * GET /.well-known/agenc-store.json — unauthenticated HTTP 200 application/json.
 * Never 402. Never attach payTo or X-Pay-To headers. Not proxied. Not AARON_PATHS.
 * Not JOE-gated. Worker never signs and never holds a key — Josh signs in Backpack later.
 *
 * Served on mcp.jettoptics.ai and aaron.jettoptics.ai only. Not apex jettoptics.ai.
 * Does not overwrite /.well-known/agent-card.json.
 */

import type { GatewayEnv } from "./lib/cors";
import { getCorsHeaders, jsonResponse } from "./lib/cors";

export const AGENC_STORE_PATH = "/.well-known/agenc-store.json";

/** Public AgenC shop URL (hosted handle). */
export const AGENC_SHOP = "https://agenc.ag/@augment";

/** Public handle. Same as prima_title handle. */
export const AGENC_HANDLE = "augment";

/** AgenC operator wallet (public-only). Same as prima_title wallet DQbS. */
export const AGENC_OPERATOR = "DQbSfPspQS2JW2EqrZcFF5KgaYZBruFJxmwhSzvTkuMU";

/**
 * dest / payTo / swarm LOAD (astro.knots.sol).
 * Same as prima_title payTo. Never faucet 5ct4.
 */
export const AGENC_DEST = "GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq";

/** Josh signs later in Backpack. This Worker never signs. */
export const AGENC_SIGNER = "backpack";

/**
 * Exact bytes for the public store document. Do not reword, add SKUs, prices,
 * or pretty-print. listings stays empty. Signature fields stay unsigned.
 */
export const AGENC_STORE_BODY =
  '{"shop":"https://agenc.ag/@augment","handle":"augment","operator":"DQbSfPspQS2JW2EqrZcFF5KgaYZBruFJxmwhSzvTkuMU","dest":"GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq","payTo":"GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq","listings":[],"signed":false,"signature":null,"signer":"backpack","note":"Send attests only after dest==GtAk on /x402/swarm or a foreign AgenC hire receipt"}';

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
