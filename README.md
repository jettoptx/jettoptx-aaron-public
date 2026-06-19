# jettoptx-aaron-public (Cloudflare Worker)

Public gateway / proxy Worker for the AARON service, served at `aaron.jettoptics.ai`.

## Purpose

- Provides a single public entrypoint (`aaron.jettoptics.ai`) with CORS handling, request tracing, and edge logic.
- Acts as a smart forwarder to the AARON service origin.
- Serves as the place to add rate limiting, auth middleware, observability (Sentry, Logpush, Analytics Engine), and caching.

## Files

- `wrangler.toml` — production config (custom domain route + vars)
- `src/index.ts` — the Worker (CORS, request IDs, proxy for the AARON endpoints)
- `package.json` / `tsconfig.json`

## Quick start

1. Install dependencies
   ```bash
   cd jettoptx-aaron-public
   npm install
   ```

2. Log in / select account (if not already)
   ```bash
   npx wrangler login
   ```

3. (Optional) Set any secrets. See `.env.example` for the supported variables.
   ```bash
   npx wrangler secret put <SECRET_NAME>
   ```

4. Develop
   ```bash
   npm run dev
   # or remote
   npx wrangler dev --remote
   ```

5. Deploy
   ```bash
   npm run deploy
   ```

6. Tail logs
   ```bash
   npm run tail
   ```

## Pointing clients to this Worker

Set the AARON base URL (`AARON_BASE_URL` / `EXPO_PUBLIC_AARON_URL`) in consuming applications to:

```
https://aaron.jettoptics.ai
```

## CORS

CORS is configured via `CORS_PROD_DOMAINS` / `CORS_DEV_DOMAINS` in `wrangler.toml` (comma separated). Add production domains, localhost for development, and Capacitor origins as needed.

## Observability

- `X-Request-ID` is generated (or passed through) on every request and echoed back and logged.
- The Worker supports `tail_consumers` (uncomment in `wrangler.toml` to wire a log tail Worker).
- Sentry instrumentation can be added via `@sentry/cloudflare` or the native Cloudflare + Sentry integration.

## Configuration

Update `name` and `account_id` in `wrangler.toml` as needed, or omit `account_id` and rely on `wrangler login`.

---

Co-Authored-By: Hedgehog Multimodal <joe@jettoptics.ai>
