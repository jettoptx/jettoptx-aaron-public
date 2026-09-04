/**
 * Emergency edge kill-switch for unauth aaron-router faucet drain.
 *
 * POST (and GET) /faucet/claim and /faucet/sol return 401 JSON and never
 * proxy to AARON_ORIGIN / never call chain. Origin joe-aaron-router still
 * needs auth-gate / rate-limit / sanitize as the durable fix.
 *
 * Exact paths only — do not prefix-match /faucet/* (would steal unrelated
 * aaron faucet routes if any are added later).
 */

import type { GatewayEnv } from "./lib/cors";
import { getCorsHeaders, jsonResponse } from "./lib/cors";

export const FAUCET_DISABLED_ERROR = "faucet temporarily disabled";
export const DOCS_DISABLED_ERROR = "docs temporarily disabled";

/** Exact claim / sol doors (optional trailing slash). */
const FAUCET_KILL_PATHS = [
  "/faucet/claim",
  "/faucet/claim/",
  "/faucet/sol",
  "/faucet/sol/",
] as const;

/**
 * FastAPI docs on aaron. Safe to edge-block with exact zone routes
 * (no host-wide steal). /docs/oauth2-redirect stays origin-side.
 */
const AARON_DOCS_KILL_PATHS = ["/docs", "/docs/", "/redoc", "/redoc/", "/openapi.json"] as const;

export function isFaucetKillSwitchPath(pathname: string): boolean {
  return (FAUCET_KILL_PATHS as readonly string[]).includes(pathname);
}

export function isAaronDocsKillSwitchPath(pathname: string): boolean {
  return (AARON_DOCS_KILL_PATHS as readonly string[]).includes(pathname);
}

export function handleFaucetKillSwitch(
  request: Request,
  env: GatewayEnv,
  requestId: string,
): Response {
  const cors = getCorsHeaders(request, env);
  cors.set("Cache-Control", "no-store");
  return jsonResponse({ error: FAUCET_DISABLED_ERROR }, 401, cors, requestId);
}

export function handleAaronDocsKillSwitch(
  request: Request,
  env: GatewayEnv,
  requestId: string,
): Response {
  const cors = getCorsHeaders(request, env);
  cors.set("Cache-Control", "no-store");
  return jsonResponse({ error: DOCS_DISABLED_ERROR }, 401, cors, requestId);
}
