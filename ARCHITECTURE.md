# jettoptx-aaron-hedgehog Architecture

## Edge gateway layer

```
Clients (Cursor, SuperGrok, Hermes, jettoptx.chat)
        │
        ▼
jettoptx-aaron-hedgehog (Cloudflare Worker)
  ├── JOE API token gate
  ├── AARON → aaron.jettoptics.ai (Jetson :8888)
  └── HEDGEHOG → hedgehog.jettoptics.ai (Jetson :8811)
```

## Data division of labor

| Plane | Technology | Role | Client |
|-------|------------|------|--------|
| **Operational** | SpacetimeDB (Jetson) | Realtime reducers, JettChat, auth, billing, devlogs, handovers | jettoptx.chat, MOJO |
| **Knowledge** (future) | Helix Cloud | MOA graph, vector RAG, saved layouts | DOJO MOA Builder, NousVis |
| **On-chain** | Solana + Helius addon | Attestations, JTX/OPTX proofs only | jettoptx-jtx-trade |
| **Compute** (future) | $SGL x402 | Agent VM containers for MOJO/DOJO | Vector augment (09) |

**Why both SpacetimeDB and Helix:** SpacetimeDB excels at gaming-speed reducers and subscriptions (JettChat). Helix excels at property graphs + vector + BM25 (MOA knowledge nodes). Sovereign chat stays on Jetson; Helix Cloud handles knowledge when you pay for full platform capability.

## NousVis synergy

[jettoptx-nousvis](https://github.com/jettoptx/jettoptx-nousvis) visualizes **SpacetimeDB operational state** today (chat rows, JTX users, agent tasks).

When Helix is adopted:

| Source | NousVis dashboard |
|--------|-------------------|
| SpacetimeDB | Realtime chat, online roster, billing events |
| Helix Cloud | MOA graph explorer, augment node heatmaps, semantic search analytics |
| Solana | JTX/OPTX/SGL on-chain stats |

Add `helix` to NousVis `db_type` selector — same plugin pattern as SpacetimeDB sync.

## Matrix rooms

| Room | Audience |
|------|----------|
| `#JTX:jettoptics.ai` | Public users + their agents |
| `#optx:jettoptics.ai` | Dev/admin broadcast rail → JOE agents only |

## Client stack (current)

- **Auth:** xAI Developer OAuth + Privy (X / email / Solana wallet)
- **App:** jettoptx.chat (DOJO) on Vercel
- **Edge:** Cloudflare Workers + tunnels
- **CI/CD:** GitHub
- **No Convex, Clerk, or Zitadel**

## Future unified plugins

Planned jettoptx plugins for: Cursor, NousVis, Helix Cloud, Cloudflare, GitHub, Vercel.

## Mobile-first roadmap

1. jtx.chat working on iOS/Android builds
2. Import augment registry + Helix MOA graph to web DOJO
3. Edge MCP Phase 1 (full SSE + xAI OAuth + SpacetimeDB token validation)
