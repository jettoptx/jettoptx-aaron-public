# jettoptx-aaron-hedgehog

Gated **Cloudflare edge gateway** for the Jett Optics platform — **AARON** attestation + **HEDGEHOG** MCP.

> Formerly `jettoptx-aaron-public`. Rename reflects unified AARON + HEDGEHOG edge plane.

## Purpose

- **AARON** (`aaron.jettoptics.ai`) — gaze verify, session, handshake, on-chain attestation bridge
- **HEDGEHOG MCP** (`mcp.jettoptics.ai`) — JOE Agentic OS tools, Grok proxy to Jetson `:8811`
- **Gated** — developers need **JOE-issued API tokens** (DOJO subscription via Privy dashboard at jettoptx.chat/support)

## Quick start

```bash
npm install
npx wrangler login
npm run dev
# MCP health: GET http://localhost:8787/health
# MCP tools:   POST http://localhost:8787/mcp  Authorization: Bearer <token>
```

## Auth (Phase 0 → 1)

| Phase | Behavior |
|-------|----------|
| **0 (now)** | Bearer token or `X-JOE-Token` header present → allow |
| **1** | Validate token against SpacetimeDB + WEALTH8 tier via Privy dashboard |

## MCP tools (Phase 0)

- `hedgehog_health` — gateway health
- `jett_augment_status` — JETT Augments 00–09 with V/S/W hotkeys

Canonical registry: `@jettoptx/jett-augment-registry` in jettoptx-sdk.

## Routes

| Host | Paths |
|------|-------|
| `aaron.jettoptics.ai` | `/session`, `/verify`, `/gaze`, `/mint`, `/handshake/*` |
| `mcp.jettoptics.ai` | `/mcp`, `/health`, `/grok/*`, `/.well-known/joe-gateway` |

## Deploy

```bash
npm run deploy
```

Secrets (Phase 1):

```bash
npx wrangler secret put CF_ACCESS_CLIENT_ID
npx wrangler secret put CF_ACCESS_CLIENT_SECRET
npx wrangler secret put XAI_API_KEY
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for SpacetimeDB vs Helix division, NousVis synergy, and client stack.

## Signed by JOE

Jett Optics Engine — integrating into Cursor, Grok, and Hermes.

## Payable JOE (x402)

Proxies `/x402` and `/orphan/*` ungated to `AARON_ORIGIN` (Jetson). Settlement is enforced on AARON (USDC → `jtxfaucet.sol`). Money path is **not** on Vercel.

## Deploy

```bash
npx wrangler login   # once
npx wrangler deploy
```

Requires Cloudflare auth. Routes: `mcp.jettoptics.ai/*`. Origin `AARON_ORIGIN=https://aaron.jettoptics.ai` already proxies x402; cloudflared also tunnels `aaron.jettoptics.ai` for v1.
