# jettoptx-aaron-public Architecture

Public **Cloudflare edge gateway** for AARON attestation routes and HEDGEHOG MCP. Does not host mesh internals or private ops tooling.

## Edge gateway layer

```
Clients (Cursor, Hermes, jettoptx.chat, agents)
        │
        ▼
jettoptx-aaron-public (Cloudflare Worker)
  ├── JOE API token gate (MCP paths)
  ├── /v MOJO deep-link (302 → jettmojo://verify?s=…)
  ├── AARON proxy → aaron.jettoptics.ai
  └── HEDGEHOG MCP → mcp.jettoptics.ai handlers / origin
```

## Data division of labor

| Plane | Technology | Role | Clients |
|-------|------------|------|---------|
| **Operational** | SpacetimeDB (edge) | Realtime state, auth, billing hooks | jettoptx.chat, MOJO |
| **Knowledge** (future) | Graph / vector store | MOA graph, RAG layouts | DOJO builder surfaces |
| **On-chain** | Solana | Attestations, JTX/OPTX proofs | jettoptx-jtx-trade, poa-depin |
| **Compute** (future) | x402 metered jobs | Agent workloads | Product tiers |

**SpacetimeDB** remains the operational realtime plane. Knowledge-graph backends are optional future capacity — not required to use this gateway.

## Client stack (current)

- **Auth:** product OAuth / wallet gates as configured on origin services  
- **App:** jettoptx.chat (DOJO) on Vercel  
- **Edge:** Cloudflare Workers + tunnels to private origin  
- **CI/CD:** GitHub  
- **Programs:** [jettoptx-poa-depin](https://github.com/jettoptx/jettoptx-poa-depin) (Apache-2.0)

## Related private surfaces

Full AARON backend (FastAPI on Jetson), mesh credentials, and operator comms are **out of scope** for this public repo. See [jettoptx-aaron-router](https://github.com/jettoptx/jettoptx-aaron-router) (private) for origin implementation.

## Mobile-first roadmap

1. jtx.chat / MOJO working on iOS/Android builds  
2. DOJO web + edge MCP Phase 1 (SSE, stronger token validation)  
3. On-chain attestation paths aligned with public poa-depin docs  

## Security notes

- No secrets in this repository — Worker secrets via Cloudflare dashboard  
- MCP auth accepts `Authorization: Bearer` and `X-JOE-Token` only (no query-string keys)  
- AARON proxy paths (including `/x402`) remain ungated at the edge; origin enforces payment/auth  
- SHIELD4 X OAuth allowlist lives in Worker secret `SHIELD4_ALLOWLIST_JSON` (fail-closed when empty)  
- Report vulnerabilities: **joe@jettoptics.ai** (see [SECURITY.md](./SECURITY.md))  
- On-chain upgrade authority: Squads vault `9Wss…` — see [on-chain addresses](https://jettoptx.dev/docs/getting-started/on-chain-addresses)
