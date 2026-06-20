/**
 * jettoptx-aaron-hedgehog — Gated edge gateway for AARON + HEDGEHOG MCP
 *
 * JOE-issued API tokens required for MCP (issue at jettoptx.chat/support).
 * AARON paths: attestation, gaze verify, handshake (not Grok mint path).
 * HEDGEHOG paths: MCP tools, Grok proxy to Jetson :8811.
 */

import type { GatewayEnv } from "./lib/cors";
import { getCorsHeaders, addRequestId, jsonResponse } from "./lib/cors";
import { validateJoeToken } from "./lib/auth-gate";
import { isAaronPath, proxyToAaron } from "./aaron-gateway";
import { isHedgehogPath, handleHedgehog } from "./hedgehog-mcp";

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
      // HEDGEHOG MCP + health
      if (isHedgehogPath(url.pathname)) {
        const auth = validateJoeToken(request, url.pathname);
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
          hint: "Use /mcp, /health, /session, /verify, /gaze",
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
