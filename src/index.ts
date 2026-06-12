/**
 * AARON Public Gateway Worker
 * Edge proxy / gateway in front of the AARON tunnel backend (aaron.jettoptics.ai).
 * 
 * Benefits:
 * - Unified CORS, request IDs, logging
 * - Easy to add rate limiting, auth, observability (Sentry, Analytics Engine, etc.)
 * - Future: move more logic to the edge or add caching
 * 
 * Primary origin: the Cloudflare Tunnel (or fallback Tailscale direct on Jetson).
 * Update the clients (aaronClient.ts etc.) BASE_URL to point here once deployed.
 */

interface Env {
  AARON_ORIGIN: string;
  ENV: string;
  CORS_PROD_DOMAINS?: string;
  CORS_DEV_DOMAINS?: string;
}

const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';

function getCorsHeaders(request: Request, env: Env): Headers {
  const origin = request.headers.get('Origin') || '';
  const allowed = [
    ...(env.CORS_PROD_DOMAINS || '').split(',').map(s => s.trim()).filter(Boolean),
    ...(env.CORS_DEV_DOMAINS || '').split(',').map(s => s.trim()).filter(Boolean),
  ];

  const allowOrigin = allowed.some(d => {
    if (d.includes('*')) {
      const re = new RegExp('^' + d.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      return re.test(origin);
    }
    return origin === d || origin.startsWith(d);
  }) ? origin : '*';

  const headers = new Headers({
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  });

  return headers;
}

function addRequestId(headers: Headers): string {
  const existing = headers.get('X-Request-ID') || headers.get('cf-ray');
  const id = existing || crypto.randomUUID();
  headers.set('X-Request-ID', id);
  return id;
}

async function proxyToAARON(request: Request, env: Env, requestId: string): Promise<Response> {
  const url = new URL(request.url);
  const originUrl = new URL(env.AARON_ORIGIN);
  
  // Build the target URL (preserve path + query)
  const target = new URL(url.pathname + url.search, originUrl);

  // Clone headers, add tracing info
  const headers = new Headers(request.headers);
  headers.set('X-Request-ID', requestId);
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

  // Important: do not forward host that would cause issues
  headers.delete('host');

  const init: RequestInit = {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
  };

  // Pass through CF context for streaming etc.
  const res = await fetch(target.toString(), init);

  // Copy response headers + add our cors + request id
  const responseHeaders = new Headers(res.headers);
  const cors = getCorsHeaders(request, env);
  cors.forEach((v, k) => responseHeaders.set(k, v));
  responseHeaders.set('X-Request-ID', requestId);
  responseHeaders.set('X-AARON-Gateway', 'cloudflare-worker');

  // Return the response (including streaming bodies)
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const requestId = addRequestId(new Headers()); // will be attached below

    // CORS preflight
    if (request.method === 'OPTIONS') {
      const cors = getCorsHeaders(request, env);
      cors.set('X-Request-ID', requestId);
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // Only proxy known AARON paths (defensive). Everything else 404 for now.
      const aaronPaths = ['/session', '/verify', '/gaze', '/mint'];
      const isAARONPath = aaronPaths.some(p => url.pathname === p || url.pathname.startsWith(p + '/'));

      if (!isAARONPath) {
        const cors = getCorsHeaders(request, env);
        cors.set('X-Request-ID', requestId);
        return new Response(JSON.stringify({ error: 'Not found', requestId }), {
          status: 404,
          headers: { ...Object.fromEntries(cors), 'Content-Type': 'application/json' },
        });
      }

      const response = await proxyToAARON(request, env, requestId);

      // Optional: log to tail / Analytics Engine in future
      // ctx.waitUntil( logRequest(...) );

      return response;
    } catch (err: any) {
      console.error('AARON gateway error', { requestId, error: err?.message || err });

      const cors = getCorsHeaders(request, env);
      cors.set('X-Request-ID', requestId);

      return new Response(JSON.stringify({
        error: 'Gateway error',
        requestId,
        message: env.ENV === 'production' ? undefined : String(err?.message || err),
      }), {
        status: 502,
        headers: { ...Object.fromEntries(cors), 'Content-Type': 'application/json' },
      });
    }
  },
};
