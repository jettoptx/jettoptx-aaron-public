/**
 * jettoptx-aaron-hedgehog — Gated edge gateway for AARON + HEDGEHOG MCP
 *
 * JOE-issued API tokens required for MCP (issue at jettoptx.chat/support).
 * AARON paths: attestation, gaze verify, handshake, x402 payable JOE APIs.
 * HEDGEHOG paths: MCP tools, Grok proxy to Jetson :8811.
 *
 * AARON paths (including /x402, /orphan) are proxied ungated — origin-enforced
 * payment / auth on the Jetson AARON router (USDC → jtxfaucet.sol). Out of scope
 * for the JOE MCP token gate unless explicitly added later.
 */

import type { GatewayEnv } from "./lib/cors";
import { getCorsHeaders, addRequestId, jsonResponse } from "./lib/cors";
import { validateJoeToken } from "./lib/auth-gate";
import { isAaronPath, isJoeHedgehogPath, isJoeMcpPath, proxyToAaron } from "./aaron-gateway";
import { isHedgehogPath, handleHedgehog, isJettchatCensusPath } from "./hedgehog-mcp";
import { isMojoDeeplinkPath, handleMojoDeeplink } from "./mojo-deeplink";

export default {
  async fetch(request: Request, env: GatewayEnv, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const requestId = addRequestId(new Headers());

    if (request.method === "OPTIONS") {
      const cors = getCorsHeaders(request, env);
      cors.set("X-Request-ID", requestId);
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // Discord / mobile MOJO deep-link (edge-only; not proxied to origin)
      if (isMojoDeeplinkPath(url.pathname)) {
        return handleMojoDeeplink(request, env, requestId);
      }

      // GET/POST /joe/mcp — Computer AddMcpServer door (header auth only).
      // First-match BEFORE isHedgehogPath and isAaronPath. Not AARON_PATHS. Not Hedgehog /mcp.
      if (
        isJoeMcpPath(url.pathname) &&
        (request.method === "GET" || request.method === "POST")
      ) {
        const auth = await validateJoeToken(request, url.pathname, env);
        if (!auth.ok) {
          const cors = getCorsHeaders(request, env);
          return jsonResponse({ error: auth.error, requestId }, 401, cors, requestId);
        }
        return proxyToAaron(request, env, requestId);
      }

      // POST/GET /joe/hedgehog — JOE-gated MCP transport proxy to AARON_ORIGIN.
      // First-match BEFORE isHedgehogPath and isAaronPath. Not AARON_PATHS. Not /mcp/*.
      if (isJoeHedgehogPath(url.pathname)) {
        const auth = await validateJoeToken(request, url.pathname, env);
        if (!auth.ok) {
          const cors = getCorsHeaders(request, env);
          return jsonResponse({ error: auth.error, requestId }, 401, cors, requestId);
        }
        return proxyToAaron(request, env, requestId);
      }

      // GET /mcp/jettchat — JOE-gated census proxy to AARON_ORIGIN (not AARON_PATHS).
      // Exact path only. Must run before isHedgehogPath or `/mcp/` swallows it.
      if (request.method === "GET" && isJettchatCensusPath(url.pathname)) {
        const auth = await validateJoeToken(request, url.pathname, env);
        if (!auth.ok) {
          const cors = getCorsHeaders(request, env);
          return jsonResponse({ error: auth.error, requestId }, 401, cors, requestId);
        }
        return proxyToAaron(request, env, requestId);
      }

      // HEDGEHOG MCP + health
      if (isHedgehogPath(url.pathname)) {
        const auth = await validateJoeToken(request, url.pathname, env);
        if (!auth.ok) {
          const cors = getCorsHeaders(request, env);
          return jsonResponse({ error: auth.error, requestId }, 401, cors, requestId);
        }
        return handleHedgehog(request, env, requestId);
      }

      // AARON attestation / gaze / handshake
      if (isAaronPath(url.pathname)) {
        return proxyToAaron(request, env, requestId);
      }

      const cors = getCorsHeaders(request, env);
      return jsonResponse(
        {
          error: "Not found",
          gateway: "jettoptx-aaron-hedgehog",
          hint: "Use /mcp, /joe/mcp, /joe/hedgehog, /mcp/jettchat, /health, /v, /session, /verify, /gaze, /x402, /orphan/402",
          requestId,
        },
        404,
        cors,
        requestId,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Gateway error", { requestId, error: message });
      const cors = getCorsHeaders(request, env);
      return jsonResponse(
        {
          error: "Gateway error",
          requestId,
          message: env.ENV === "production" ? undefined : message,
        },
        502,
        cors,
        requestId,
      );
    }
  },
};

export type { GatewayEnv };
