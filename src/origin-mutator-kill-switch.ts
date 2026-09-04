/**
 * Emergency edge kill-switch for leftover unauth aaron-router mutators.
 *
 * Origin joe-aaron-router PR24 is live, but leftover mutators still return
 * unauth 200s. Worst: POST /jett/totp/enroll returns a TOTP secret with no JWT.
 *
 * Exact paths only — never steal login bootstrap:
 * /session, /jett/totp/challenge, /jett/challenge/create stay origin-side.
 *
 * JOE token does not bypass. No AARON_ORIGIN proxy.
 */

import type { GatewayEnv } from "./lib/cors";
import { getCorsHeaders, jsonResponse } from "./lib/cors";

export const ORIGIN_MUTATOR_DISABLED_ERROR = "unauthorized — temporarily disabled";

/**
 * CRITICAL leftover mutators (optional trailing slash).
 * Path-only — GET+POST (and any other method) 401. OPTIONS stays 204 in index.
 */
const ORIGIN_MUTATOR_KILL_PATHS = [
  "/jett/totp/enroll",
  "/jett/totp/enroll/",
  "/jett/totp/verify",
  "/jett/totp/verify/",
  "/gaze/analyze",
  "/gaze/analyze/",
  "/poa/claim",
  "/poa/claim/",
  "/donations/claim",
  "/donations/claim/",
  "/handshake/start",
  "/handshake/start/",
  "/handshake/done",
  "/handshake/done/",
  "/hermesync/pair",
  "/hermesync/pair/",
  "/jett/challenge/scanned",
  "/jett/challenge/scanned/",
  "/orphan/claim",
  "/orphan/claim/",
  "/audit/devnet",
  "/audit/devnet/",
] as const;

/** Login bootstrap — must never match the kill-switch. */
const LOGIN_BOOTSTRAP_PATHS = [
  "/session",
  "/session/",
  "/jett/totp/challenge",
  "/jett/totp/challenge/",
  "/jett/challenge/create",
  "/jett/challenge/create/",
] as const;

export function isOriginMutatorKillSwitchPath(pathname: string): boolean {
  return (ORIGIN_MUTATOR_KILL_PATHS as readonly string[]).includes(pathname);
}

export function isLoginBootstrapPath(pathname: string): boolean {
  return (LOGIN_BOOTSTRAP_PATHS as readonly string[]).includes(pathname);
}

export function handleOriginMutatorKillSwitch(
  request: Request,
  env: GatewayEnv,
  requestId: string,
): Response {
  const cors = getCorsHeaders(request, env);
  cors.set("Cache-Control", "no-store");
  return jsonResponse({ error: ORIGIN_MUTATOR_DISABLED_ERROR }, 401, cors, requestId);
}
