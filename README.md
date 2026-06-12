# aaron-public (Cloudflare Worker)

Public gateway / proxy Worker for the AARON service.

## Purpose
- Single public entrypoint (aaron.jettoptics.ai) with good CORS, request tracing, and edge logic.
- Currently a smart forwarder to the existing Cloudflare Tunnel (`https://aaron.jettoptics.ai`).
- Easy place to later add rate limiting, auth middleware, observability (Sentry, Logpush, Analytics Engine), caching, etc.
- Matches the recent Sentry instrumentation work on the client side (`aaronClient.ts`).

## Files
- `wrangler.toml` — production config (custom domain route + vars)
- `src/index.ts` — the Worker (CORS, request IDs, proxy for the AARON endpoints)
- `package.json` / `tsconfig.json`

## Quick start

1. Install deps
   ```bash
   cd OPTX-Cortex/workers/aaron-public
   npm install
   ```

2. Login / select account (if not already)
   ```bash
   npx wrangler login
   ```

3. (Optional) set any secrets
   ```bash
   npx wrangler secret put SOME_SECRET
   ```

4. Dev
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

## Point clients to this Worker

Update the `AARON_BASE_URL` (or `EXPO_PUBLIC_AARON_URL`) in consuming code (e.g. the mojo app and any Node services) to:

```
https://aaron.jettoptics.ai
```

(or a dedicated subdomain if you prefer to keep the pure tunnel as fallback).

The old direct tunnel remains available as fallback while you cut over.

## CORS

Configured via `CORS_PROD_DOMAINS` / `CORS_DEV_DOMAINS` in wrangler.toml (comma separated). Matches the pattern used in your other Workers (vault/partyserver).

Add your Vercel preview domains, localhost for dev, capacitor origins, etc.

## Observability

- `X-Request-ID` is generated (or passed through) on every request and echoed back + logged.
- The Worker is ready for `tail_consumers` (uncomment in wrangler.toml if you have a log tail Worker).
- Easy to add `@sentry/cloudflare` or native CF + Sentry integration later (we just added client-side Sentry for the same service).

## Tunnel relationship

This Worker is intended to become the primary public hostname for AARON.

Options:
- Keep the Cloudflare Tunnel as the origin that this Worker proxies to (current design).
- Or reconfigure the tunnel public hostname to point elsewhere / use it only as internal fallback.
- Update tunnel config (dashboard or cloudflared config.yml) if you want the tunnel hostname to serve a 404 or redirect while the Worker owns the traffic.

See the cloudflare skill `references/tunnel/` for patterns.

## Next steps / ideas
- Add simple rate limiting or bot protection (using the bot-management or manual).
- Add a small amount of edge validation on the gaze payloads.
- Wire Analytics Engine or a tail Worker for request metrics.
- Add Sentry for the Worker itself (different DSN or same org/project).
- Move more of the AARON router logic (currently in Python aaron-router) into this Worker + DOs if it makes sense for latency/auth.

## Deployed name / account

Update `name` and `account_id` (or remove account_id and rely on `wrangler login`) as needed. The current example matches your other production Workers.

---

Co-Authored-By: Hedgehog Multimodal <joe@jettoptics.ai>
