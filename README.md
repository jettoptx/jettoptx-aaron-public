# jettoptx-aaron-public

**Public Cloudflare edge gateway** for Jett Optics — fronts **AARON** (attestation API) and **HEDGEHOG MCP** without exposing the Jetson mesh.

> Package name in `package.json`: `jettoptx-aaron-hedgehog` (AARON + HEDGEHOG edge plane).  
> **Backend / full router source** (private ops): [jettoptx-aaron-router](https://github.com/jettoptx/jettoptx-aaron-router)  
> **Docs:** [Edge Gateway](https://jettoptx.dev/docs/infrastructure/edge-gateway) · [Protocol](https://jettoptx.dev/docs/protocol)

## What this is (and is not)

| This repo | Not this repo |
|-----------|----------------|
| Cloudflare Worker (edge proxy + MCP gate) | Full FastAPI AARON on Jetson (`aaron_router.py`) |
| Public-safe source for integrators | Secrets, Tailscale, or mesh credentials |
| CORS, request IDs, path routing | On-chain program bytecode ([jettoptx-poa-depin](https://github.com/jettoptx/jettoptx-poa-depin)) |

## Hosts

| Host | Role |
|------|------|
| `aaron.jettoptics.ai` | AARON REST — session, verify, gaze, handshake, x402 proxy |
| `mcp.jettoptics.ai` | HEDGEHOG MCP tools + health; JOE-gated `GET/POST /joe/mcp` (AddMcpServer); JOE-gated `POST/GET /joe/hedgehog`; JOE-gated `POST/GET /joe/ore/rpc` + `GET /joe/ore/subscribe` (ORE/AgenC porch); JOE-gated `GET /mcp/jettchat` census; Discord/mobile MOJO deep-link |

## MOJO deep-link (`/v`)

Public Discord / mobile entry (edge-only, not proxied to AARON origin):

```text
GET https://mcp.jettoptics.ai/v?s={opaqueSessionId}
→ 302 Location: jettmojo://verify?s={opaqueSessionId}
```

`s` must be URL-safe `A-Za-z0-9_-`, length 8–128. Missing or invalid → `400` (no redirect). No secrets in the URL — opaque session id only.

## Auth

MCP paths (`/mcp`, `GET/POST /joe/mcp`, `POST/GET /joe/hedgehog`, `POST/GET /joe/ore/rpc`, `GET /joe/ore/subscribe`, `GET /mcp/jettchat`, and non-public HEDGEHOG routes) are gated by `validateJoeToken` in `src/lib/auth-gate.ts`. Public without a token: `/health`, `/.well-known/joe-gateway`, and `GET /specs/prima-depin-job.json`.

**Joe/mcp (Computer AddMcpServer only):** `GET`/`POST` `https://mcp.jettoptics.ai/joe/mcp` and `/joe/mcp/sse`. Auth is **header-only** — `Authorization: Bearer` or `X-JOE-Token`. No token in the URL (`?token=` / `?key=` → `401`). Missing header → `401` (no proxy); a phone sheet cannot auth. On success the Worker `proxyToAaron` to `AARON_ORIGIN`. **Not** in ungated `AARON_PATHS`. **Not** Hedgehog `/mcp`. First-match before `isHedgehogPath` / `isAaronPath`.

**Joe/hedgehog MCP transport:** `POST`/`GET` `https://mcp.jettoptics.ai/joe/hedgehog` (optional trailing slash; SSE sibling `/joe/hedgehog/sse`) with `Authorization: Bearer` or `X-JOE-Token` (same `validateJoeToken` as `/mcp`). Missing or wrong token → `401` (no proxy). On success the Worker `proxyToAaron` to `AARON_ORIGIN` — this path is **not** in ungated `AARON_PATHS`, is **not** the JettChat census, and is **not** proxied to Hedgehog `:8811`. First-match before `isHedgehogPath` / `isAaronPath` so `/mcp/*` cannot swallow it. The Worker does not implement MCP tools or run SQL.

**Joe/ore (ORE / AgenC porch):** live doors match origin joe-aaron-router — `POST`/`GET` `https://mcp.jettoptics.ai/joe/ore/rpc` and `GET` `https://mcp.jettoptics.ai/joe/ore/subscribe` (SSE summaries; optional trailing slashes). Also first-matches `/joe/ore` and `/joe/ore/sse`. Auth is the same `validateJoeToken` as `/joe/hedgehog` (`Authorization: Bearer` or `X-JOE-Token`). Missing or wrong token → **`401` (never 404, no proxy)**. On success the Worker `proxyToAaron` with the **original path** (`/joe/ore/rpc` → origin `/joe/ore/rpc`). **Not** in ungated `AARON_PATHS`. Explicit path list only — `/joe/ore/extra` is not this door. This Worker has **no Helius** — do not set `HELIUS_API_KEY`, a `SOLANA_RPC_URL` with an api-key, or a new `HELIUS_MAINNET_RPC` here. Paid Helius/gRPC subscribe for program `oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv` stays on **joe-aaron-router** (`AARON_ORIGIN`). First-match before `isHedgehogPath` / `isAaronPath`.

**JettChat census (Grok Bots):** `GET https://mcp.jettoptics.ai/mcp/jettchat` with `Authorization: Bearer` or `X-JOE-Token` (same JOE token as `/mcp`). Missing or wrong token → `401` (no proxy). On success the Worker proxies to `AARON_ORIGIN` — this path is **not** in ungated `AARON_PATHS`. Exact path only (`/mcp/jettchat/…` is not this route). `POST /mcp` remains HEDGEHOG MCP.

| Credential | How to send | Behavior |
|------------|-------------|----------|
| Static admin key (`MCP_API_KEY` Worker secret) | `Authorization: Bearer` or `X-JOE-Token` | Accept (spaceCowboy tier) |
| SpacetimeDB `jtx_api_key` | `Authorization: Bearer` or `X-JOE-Token` | Hash lookup via SpacetimeDB HTTP SQL |
| X OAuth access token | `Authorization: Bearer` only | Map username → `SHIELD4_ALLOWLIST_JSON` + billing gate |

**X OAuth allowlist:** set Worker secret `SHIELD4_ALLOWLIST_JSON` to a JSON object keyed by X username (lowercase), e.g. `{"example_user":{"twinId":"example_user","wallet":"…","founderBypass":false}}`. Empty, unset, or invalid JSON fails closed for X OAuth only — `MCP_API_KEY` and SpacetimeDB keys continue to work. Do not commit real wallets or emails.

**Do not** put API keys in the query string (`?key=`). Query credentials leak via access logs, proxies, and `Referer`.

AARON routes (`/session`, `/verify`, `/gaze`, `/x402/v1/*`, `/orphan`, …) are **proxied ungated** by this Worker — payment and origin auth remain on the Jetson AARON router (USDC settlement → `jtxfaucet.sol` / `5ct4…`).

**Edge x402 exceptions (not proxied):**

| Path | Unauth | payTo | After settle |
|------|--------|-------|--------------|
| `GET /x402` | 200 catalog | top-level `5ct4…` (faucet). `prima_title` dest/`payTo` is `GtAk…` (`astro.knots.sol`) | — |
| `GET /x402/prima_title` | **402** (never 404) | `GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq` only | signed meter `kind: jett.primaTitle.v0` (operator Prima, handle augment, wallet `DQbS…`). Does **not** grant NCL Voyage minutes, Starlink bytes, boat SSID, or passenger location |

Price for `prima_title` reuses live catalog `task`: `priceUsdc` 0.05 / `priceAtomic` 50000. Preferred live door: `https://aaron.jettoptics.ai/x402/prima_title` (also on `mcp.jettoptics.ai` if this Worker is the street). Do not flip chat / gaze_analyze / task / orphan_donate off `5ct4`.

**Public marketplace job spec (not proxied, never 402):**

| Path | Unauth | Headers | Body |
|------|--------|---------|------|
| `GET /specs/prima-depin-job.json` | **200** `application/json` | no `payTo`, no `X-Pay-To` | exact `agenc.marketplace.jobSpec` JSON |

Live door: `https://aaron.jettoptics.ai/specs/prima-depin-job.json` (mirror on `mcp.jettoptics.ai`). This is the JOB-SPEC URI for agenc.ag/create — not the 402 title.

SpacetimeDB HTTP `/sql` has no parameter binding; values interpolated into SQL are charset-whitelisted (`twinId`) or hex-validated (`key_hash`) before use.

Issue developer tokens via DOJO / support at [jettoptx.chat](https://jettoptx.chat).

## MCP tools (HEDGEHOG / search06)

All `/mcp` `tools/call` requests require a JOE token (except public `/health`).

| Tool | Augment | Purpose |
|------|---------|---------|
| `hedgehog_health` | 00 Core | Edge gateway liveness |
| `jett_augment_status` | 00 / 06 | List augments 00–09 (`status: "registered"`) |
| `jett_docs_search` | **06 Search** | `GET docs.jettoptx.dev/api/search?query=` (Fumadocs; not `?q=`); absolute `docs.jettoptx.dev` links; static index fallback |
| `jett_augment_lookup` | **06 Search** | Look up one augment by digit/name (role, HEAT, AGT) |
| `jett_edge_diagnose` | **06 Search** | Configured hosts, tool list, optional origin/docs probes (no secrets) |

Example (after auth):

```bash
# Docs search
curl -sS https://mcp.jettoptics.ai/mcp \
  -H "Authorization: Bearer $JOE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"jett_docs_search","arguments":{"query":"edge gateway","limit":5}}}'

# Augment lookup
curl -sS https://mcp.jettoptics.ai/mcp \
  -H "Authorization: Bearer $JOE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"jett_augment_lookup","arguments":{"digit":"06"}}}'

# Edge diagnose (set probe:false to skip outbound HEADs)
curl -sS https://mcp.jettoptics.ai/mcp \
  -H "Authorization: Bearer $JOE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"jett_edge_diagnose","arguments":{"probe":true}}}'
```

## Quick start

```bash
git clone https://github.com/jettoptx/jettoptx-aaron-public.git
cd jettoptx-aaron-public
npm install
cp .env.example .dev.vars   # optional local secrets
npx wrangler login
npm run dev
# GET  http://localhost:8787/health
# POST http://localhost:8787/mcp  Authorization: Bearer <token>
```

## Deploy

```bash
npm run deploy
```

Secrets (dashboard or CLI — **never commit**):

```bash
npx wrangler secret put MCP_API_KEY
npx wrangler secret put SHIELD4_ALLOWLIST_JSON   # X OAuth allowlist JSON (see Auth)
npx wrangler secret put HELIUS_MAINNET_RPC       # optional
# Optional:
# npx wrangler secret put CF_ACCESS_CLIENT_ID
# npx wrangler secret put CF_ACCESS_CLIENT_SECRET
# npx wrangler secret put XAI_API_KEY
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for edge planes, client stack, and security notes.

```text
Client  →  Cloudflare Worker (this repo)
              ├── GET/POST /joe/mcp → JOE header gate → proxy → AARON_ORIGIN (AddMcpServer; not AARON_PATHS)
              ├── POST/GET /joe/hedgehog → JOE token gate → proxy → AARON_ORIGIN (not AARON_PATHS)
              ├── POST/GET /joe/ore/rpc + GET /joe/ore/subscribe → JOE token gate → proxy → AARON_ORIGIN (ORE/AgenC; Helius on origin)
              ├── GET /mcp/jettchat → JOE token gate → proxy → AARON_ORIGIN (census; not AARON_PATHS)
              ├── GET /specs/prima-depin-job.json → public 200 JSON (never 402; not proxied)
              ├── /mcp, /health     → HEDGEHOG MCP handlers (JOE token gate)
              └── /session,/verify… → proxy → aaron.jettoptics.ai (Jetson tunnel; ungated at edge)
```

On-chain programs and upgrade authority: [poa-depin README](https://github.com/jettoptx/jettoptx-poa-depin) · [on-chain addresses](https://jettoptx.dev/docs/getting-started/on-chain-addresses).

## Related repos

| Repo | Visibility (intent) | Role |
|------|---------------------|------|
| [jettoptx-docs](https://github.com/jettoptx/jettoptx-docs) | Public | Developer docs site |
| [jettoptx-poa-depin](https://github.com/jettoptx/jettoptx-poa-depin) | Public (programs) | Solana PoA Trust + Vault |
| [jettoptx-aaron-public](https://github.com/jettoptx/jettoptx-aaron-public) | Public (this) | Edge Worker |
| [jettoptx-aaron-router](https://github.com/jettoptx/jettoptx-aaron-router) | Private | Full AARON backend + SDKs |
| [jettoptx-xwealth](https://github.com/jettoptx/jettoptx-xwealth) | Public | X Money / JTX gate plugins |

## License

Apache-2.0 — see [LICENSE](./LICENSE). Vulnerability reports: [SECURITY.md](./SECURITY.md).
