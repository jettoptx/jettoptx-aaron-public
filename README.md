# jettoptx-aaron-public

**Public Cloudflare edge gateway** for Jett Optics â€” fronts **AARON** (attestation API) and **HEDGEHOG MCP** without exposing the Jetson mesh.

> Package name in `package.json`: `jettoptx-aaron-hedgehog` (AARON + HEDGEHOG edge plane).  
> **Backend / full router source** (private ops): [jettoptx-aaron-router](https://github.com/jettoptx/jettoptx-aaron-router)  
> **Docs:** [Edge Gateway](https://jettoptx.dev/docs/infrastructure/edge-gateway) Â· [Protocol](https://jettoptx.dev/docs/protocol)

## What this is (and is not)

| This repo | Not this repo |
|-----------|----------------|
| Cloudflare Worker (edge proxy + MCP gate) | Full FastAPI AARON on Jetson (`aaron_router.py`) |
| Public-safe source for integrators | Secrets, Tailscale, or mesh credentials |
| CORS, request IDs, path routing | On-chain program bytecode ([jettoptx-poa-depin](https://github.com/jettoptx/jettoptx-poa-depin)) |

## Hosts

| Host | Role |
|------|------|
| `aaron.jettoptics.ai` | AARON REST â€” session, verify, gaze, handshake, x402 proxy |
| `mcp.jettoptics.ai` | HEDGEHOG MCP tools + health |

## Auth

| Phase | Behavior |
|-------|----------|
| **0** | Bearer / `X-JOE-Token` present â†’ allow MCP |
| **1** | Validate token against SpacetimeDB + subscription tier |

Issue developer tokens via DOJO / support at [jettoptx.chat](https://jettoptx.chat).  
x402 / payment routes are enforced on the **origin AARON** backend (USDC settlement), not by inventing keys in this Worker.

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

Secrets (dashboard or CLI â€” **never commit**):

```bash
npx wrangler secret put MCP_API_KEY
npx wrangler secret put HELIUS_MAINNET_RPC   # optional
# Phase 1 / optional:
# npx wrangler secret put CF_ACCESS_CLIENT_ID
# npx wrangler secret put CF_ACCESS_CLIENT_SECRET
# npx wrangler secret put XAI_API_KEY
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for edge planes, client stack, and security notes.

```text
Client  â†’  Cloudflare Worker (this repo)
              â”œâ”€ /mcp, /health     â†’ HEDGEHOG MCP handlers
              â””â”€ /session,/verifyâ€¦ â†’ proxy â†’ aaron.jettoptics.ai (Jetson tunnel)
```

On-chain programs and upgrade authority: [poa-depin README](https://github.com/jettoptx/jettoptx-poa-depin) Â· [on-chain addresses](https://jettoptx.dev/docs/getting-started/on-chain-addresses).

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
