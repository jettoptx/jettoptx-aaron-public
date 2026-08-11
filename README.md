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
| `mcp.jettoptics.ai` | HEDGEHOG MCP tools + health |

## Auth

MCP paths (`/mcp`, and non-public HEDGEHOG routes) are gated by `validateJoeToken` in `src/lib/auth-gate.ts`. Public without a token: `/health` and `/.well-known/joe-gateway`.

| Credential | How to send | Behavior |
|------------|-------------|----------|
| Static admin key (`MCP_API_KEY` Worker secret) | `Authorization: Bearer` or `X-JOE-Token` | Accept (spaceCowboy tier) |
| SpacetimeDB `jtx_api_key` | `Authorization: Bearer` or `X-JOE-Token` | Hash lookup via SpacetimeDB HTTP SQL |
| X OAuth access token | `Authorization: Bearer` only | Map username → SHIELD4 allowlist + billing gate |

**Do not** put API keys in the query string (`?key=`). Query credentials leak via access logs, proxies, and `Referer`.

AARON routes (`/session`, `/verify`, `/gaze`, `/x402`, `/orphan`, …) are **proxied ungated** by this Worker — payment and origin auth remain on the Jetson AARON router (USDC settlement). Gating them here is out of scope unless added deliberately later.

SpacetimeDB HTTP `/sql` has no parameter binding; values interpolated into SQL are charset-whitelisted (`twinId`) or hex-validated (`key_hash`) before use.

Issue developer tokens via DOJO / support at [jettoptx.chat](https://jettoptx.chat).

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
npx wrangler secret put HELIUS_MAINNET_RPC   # optional
# Optional:
# npx wrangler secret put CF_ACCESS_CLIENT_ID
# npx wrangler secret put CF_ACCESS_CLIENT_SECRET
# npx wrangler secret put XAI_API_KEY
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for edge planes, client stack, and security notes.

```text
Client  →  Cloudflare Worker (this repo)
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
