/**
 * Discord / mobile deep-link for MOJO verify.
 * Edge-only: never proxied to AARON origin.
 */

import type { GatewayEnv } from "./lib/cors";
import { getCorsHeaders, jsonResponse } from "./lib/cors";

/** Opaque session id: URL-safe A-Za-z0-9_-, length 8–128. */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function isMojoDeeplinkPath(pathname: string): boolean {
  return pathname === "/v";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function handleMojoDeeplink(
  request: Request,
  env: GatewayEnv,
  requestId: string,
): Response {
  const cors = getCorsHeaders(request, env);
  cors.set("X-Request-ID", requestId);

  if (request.method !== "GET" && request.method !== "HEAD") {
    cors.set("Allow", "GET, HEAD");
    return jsonResponse(
      { error: "Method not allowed", requestId },
      405,
      cors,
      requestId,
    );
  }

  const url = new URL(request.url);
  const s = url.searchParams.get("s");

  if (!s || !SESSION_ID_RE.test(s)) {
    return jsonResponse(
      {
        error: "Invalid or missing session id",
        hint: "Query param s must be URL-safe A-Za-z0-9_-, length 8–128",
        requestId,
      },
      400,
      cors,
      requestId,
    );
  }

  const deepLink = `jettmojo://verify?s=${encodeURIComponent(s)}`;
  const headers = new Headers(cors);
  headers.set("Location", deepLink);
  headers.set("Cache-Control", "no-store");

  if (request.method === "HEAD") {
    return new Response(null, { status: 302, headers });
  }

  const safeHref = escapeHtml(deepLink);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Open in MOJO</title>
<meta http-equiv="refresh" content="0;url=${safeHref}"/>
</head>
<body>
<p><a href="${safeHref}">Open in MOJO</a></p>
</body>
</html>`;

  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(html, { status: 302, headers });
}
