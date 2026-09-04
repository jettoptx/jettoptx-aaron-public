/**
 * jettoptx-aaron-hedgehog — Gated edge gateway for AARON + HEDGEHOG MCP
 *
 * JOE-issued API tokens required for computer MCP doors (issue at jettoptx.chat/support).
 * SuperGrok phone connectors use OAuth at /joe/hedgehog (public 6 tools; no JOE token paste).
 * AARON paths: attestation, gaze verify, handshake, x402 payable JOE APIs.
 * HEDGEHOG paths: MCP tools, Grok proxy to Jetson :8811.
 *
 * AARON paths (including /x402, /orphan) are proxied ungated — origin-enforced
 * payment / auth on the Jetson AARON router (USDC → jtxfaucet.sol). Out of scope
 * for the JOE MCP token gate unless explicitly added later.
 *
 * Exception (edge, not proxied): GET /x402 catalog (faucet 5ct4 SKUs only).
 * prima_title removed (Josh 2026-09-03).
 *
 * Emergency (edge, not proxied): POST/GET /faucet/claim and /faucet/sol
 * return 401 {error:"faucet temporarily disabled"} — no AARON_ORIGIN proxy,
 * no chain. Zone routes attach aaron.jettoptics.ai/faucet/claim* and
 * aaron.jettoptics.ai/faucet/sol* only (not the whole aaron host).
 * Origin joe-aaron-router still needs auth-gate/rate-limit/sanitize.
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
import { handleX402Catalog, isX402CatalogPath } from "./x402-catalog";
import {
  handleAaronDocsKillSwitch,
  handleFaucetKillSwitch,
  isAaronDocsKillSwitchPath,
  isFaucetKillSwitchPath,
} from "./faucet-kill-switch";

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
      // Emergency faucet kill-switch — first-match BEFORE any proxy / catalog.
      // GET+POST /faucet/claim and /faucet/sol (optional slash). No chain, no origin.
      if (isFaucetKillSwitchPath(url.pathname)) {
        return handleFaucetKillSwitch(request, env, requestId);
      }

      // Exact aaron FastAPI docs doors (optional). Zone routes are path-exact.
      if (isAaronDocsKillSwitchPath(url.pathname)) {
        return handleAaronDocsKillSwitch(request, env, requestId);
      }

      // Discord / mobile MOJO deep-link (edge-only; not proxied to origin)
      if (isMojoDeeplinkPath(url.pathname)) {
        return handleMojoDeeplink(request, env, requestId);
      }

      // GET /x402 — faucet catalog only (chat / gaze / task / orphan). No prima_title.
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
          hint: "Use /mcp, /joe/mcp, /joe/hedgehog (SuperGrok OAuth), /oauth/authorize, /joe/ore/rpc, /joe/ore/subscribe, /mcp/jettchat, /health, /v, /session, /verify, /gaze, /x402, /orphan/402",
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
