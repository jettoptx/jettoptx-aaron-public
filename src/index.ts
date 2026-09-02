/**
 * jettoptx-aaron-hedgehog — Gated edge gateway for AARON + HEDGEHOG MCP
 *
 * JOE-issued API tokens required for computer MCP doors (issue at jettoptx.chat/support).
 * SuperGrok phone connectors use OAuth at /joe/hedgehog (public 5 tools; no JOE token paste).
 * AARON paths: attestation, gaze verify, handshake, x402 payable JOE APIs.
 * HEDGEHOG paths: MCP tools, Grok proxy to Jetson :8811.
 *
 * AARON paths (including /x402, /orphan) are proxied ungated — origin-enforced
 * payment / auth on the Jetson AARON router (USDC → jtxfaucet.sol). Out of scope
 * for the JOE MCP token gate unless explicitly added later.
 *
 * Exception (edge, not proxied): GET /x402 catalog + GET /x402/prima_title.
 * prima_title payTo is GtAk (astro.knots.sol). Other x402 services stay 5ct4.
 *
 * Public JOB-SPEC (edge, not proxied, never 402): GET /specs/prima-depin-job.json.
 */

import type { GatewayEnv } from "./lib/cors";
import { getCorsHeaders, addRequestId, jsonResponse } from "./lib/cors";
import { validateJoeToken } from "./lib/auth-gate";
import { isAaronPath, isJoeHedgehogPath, isJoeMcpPath, isJoeOrePath, proxyToAaron } from "./aaron-gateway";
import { isHedgehogPath, handleHedgehog, handleMcpSession, isJettchatCensusPath } from "./hedgehog-mcp";
import {
  handleMcpOauthRequest,
  isMcpOauthDiscoveryPath,
  isMcpOauthProtocolPath,
  isPublicOAuthMcpPath,
  looksLikeMcpOauthJwt,
  mcpOauthChallengeHeaders,
  urlHasCredentialQuery,
  verifyMcpAccessToken,
} from "./lib/mcp-oauth";
import { isMojoDeeplinkPath, handleMojoDeeplink } from "./mojo-deeplink";
import {
  handlePrimaTitle,
  handleX402Catalog,
  isPrimaTitlePath,
  isX402CatalogPath,
} from "./x402-prima-title";
import { handlePrimaDepinJobSpec, isPrimaDepinJobSpecPath } from "./prima-depin-job-spec";

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

      // GET /specs/prima-depin-job.json — public JOB-SPEC (200 JSON). Never 402. Never payTo.
      if (isPrimaDepinJobSpecPath(url.pathname)) {
        return handlePrimaDepinJobSpec(request, env, requestId);
      }

      // GET /x402/prima_title — edge 402 (payTo GtAk). First-match; never proxy (origin 404s).
      if (isPrimaTitlePath(url.pathname)) {
        return handlePrimaTitle(request, env, requestId);
      }

      // GET /x402 — catalog with existing four services + prima_title (dest GtAk).
      if (isX402CatalogPath(url.pathname)) {
        return handleX402Catalog(request, env, requestId);
      }

      // SuperGrok MCP OAuth (RFC 8414/7591/9728). Public metadata + DCR + PKCE.
      // Does not unlock /joe/ore, /joe/mcp proxy, census, Helius, Stripe, or x402.
      if (isMcpOauthDiscoveryPath(url.pathname) || isMcpOauthProtocolPath(url.pathname)) {
        return handleMcpOauthRequest(request, env, requestId);
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

      // POST/GET /joe/hedgehog — SuperGrok OAuth serves local public tools;
      // JOE token still proxies to AARON_ORIGIN (computer door).
      // First-match BEFORE isHedgehogPath and isAaronPath. Not AARON_PATHS. Not /mcp/*.
      if (isJoeHedgehogPath(url.pathname)) {
        const oauth = await maybePublicMcpOauth(request, env, url.origin);
        if (oauth === "invalid") {
          return unauthorizedPublicMcp(request, env, requestId, "/joe/hedgehog");
        }
        if (oauth === "ok") {
          return handleMcpSession(request, env, requestId);
        }
        const auth = await validateJoeToken(request, url.pathname, env);
        if (!auth.ok) {
          return unauthorizedPublicMcp(request, env, requestId, "/joe/hedgehog", auth.error);
        }
        return proxyToAaron(request, env, requestId);
      }

      // GET/POST /joe/ore/rpc and GET /joe/ore/subscribe — JOE-gated ORE/AgenC porch.
      // Proxies the original path to AARON_ORIGIN only (origin joe-aaron-router PR 17).
      // Helius/gRPC stays on origin. Worker has no HELIUS_API_KEY / paid RPC. Not AARON_PATHS.
      // First-match BEFORE isHedgehogPath and isAaronPath. Unauth GET/POST → 401, never 404.
      if (isJoeOrePath(url.pathname)) {
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
        if (isPublicOAuthMcpPath(url.pathname)) {
          const oauth = await maybePublicMcpOauth(request, env, url.origin);
          if (oauth === "invalid") {
            return unauthorizedPublicMcp(request, env, requestId, "/mcp");
          }
          if (oauth === "ok") {
            return handleHedgehog(request, env, requestId);
          }
        }
        const auth = await validateJoeToken(request, url.pathname, env);
        if (!auth.ok) {
          if (isPublicOAuthMcpPath(url.pathname)) {
            return unauthorizedPublicMcp(request, env, requestId, "/mcp", auth.error);
          }
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
          hint: "Use /mcp, /joe/mcp, /joe/hedgehog (SuperGrok OAuth), /oauth/authorize, /joe/ore/rpc, /joe/ore/subscribe, /mcp/jettchat, /health, /v, /session, /verify, /gaze, /x402, /orphan/402, /specs/prima-depin-job.json",
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

async function maybePublicMcpOauth(
  request: Request,
  env: GatewayEnv,
  origin: string,
): Promise<"ok" | "invalid" | "absent"> {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return "absent";
  const token = authHeader.slice(7).trim();
  if (!token) return "absent";
  if (!looksLikeMcpOauthJwt(token)) return "absent";
  const verified = await verifyMcpAccessToken(token, env, origin);
  return verified.ok ? "ok" : "invalid";
}

function unauthorizedPublicMcp(
  request: Request,
  env: GatewayEnv,
  requestId: string,
  resourcePath: string,
  error?: string,
): Response {
  const cors = getCorsHeaders(request, env);
  const origin = new URL(request.url).origin;
  cors.set("WWW-Authenticate", mcpOauthChallengeHeaders(origin, resourcePath));
  cors.set("Cache-Control", "no-store");
  const reqUrl = new URL(request.url);
  if (urlHasCredentialQuery(reqUrl)) {
    return jsonResponse(
      {
        error:
          "Unauthorized — do not put tokens in the URL. Paste https://mcp.jettoptics.ai/joe/hedgehog and complete SuperGrok OAuth.",
        requestId,
      },
      401,
      cors,
      requestId,
    );
  }
  return jsonResponse(
    {
      error:
        error ??
        "Unauthorized — complete SuperGrok OAuth or send a JOE API token (Authorization: Bearer / X-JOE-Token).",
      requestId,
    },
    401,
    cors,
    requestId,
  );
}

export type { GatewayEnv };
