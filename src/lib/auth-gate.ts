/**
 * JOE-issued API token gate (Phase 0 stub).
 * Phase 1: validate against Privy/dashboard-issued tokens via SpacetimeDB.
 */

export interface AuthResult {
  ok: boolean;
  error?: string;
  identity?: string;
  method?: "bearer" | "api-key" | "public-health";
}

export function validateJoeToken(request: Request, pathname: string): AuthResult {
  // Public health + MCP discovery without auth
  if (pathname === "/health" || pathname === "/.well-known/joe-gateway") {
    return { ok: true, method: "public-health", identity: "public" };
  }

  const auth = request.headers.get("Authorization") ?? "";
  const apiKey = request.headers.get("X-JOE-Token") ?? new URL(request.url).searchParams.get("key");

  if (auth.startsWith("Bearer ") && auth.length > 14) {
    return { ok: true, method: "bearer", identity: "joe-token" };
  }

  if (apiKey && apiKey.length >= 16) {
    return { ok: true, method: "api-key", identity: "api-key" };
  }

  return {
    ok: false,
    error: "Unauthorized — JOE API token required. Issue tokens from jettoptx.chat/support (DOJO subscription).",
  };
}
