# jettoptx-aaron-public Architecture

Public **Cloudflare edge gateway** for AARON attestation routes and HEDGEHOG MCP. Does not host mesh internals or private ops tooling.

## Edge gateway layer

```
Clients (Cursor, Hermes, jettoptx.chat, SuperGrok, agents)
        │
        ▼
jettoptx-aaron-public (Cloudflare Worker)
  ├── CORS: reflect ACAO only for CORS_PROD_DOMAINS / CORS_DEV_DOMAINS
  ├── Emergency kill-switches (401, never proxy): faucet claim/sol, totp enroll fire, aaron /docs
  ├── SuperGrok MCP OAuth (DCR + PKCE + signed csrf_token; public 6 tools at /joe/hedgehog)
  ├── JOE API token gate: /mcp, /joe/mcp, /joe/ore/*, GET /mcp/jettchat
  ├── GET /x402 catalog (faucet payTo 5ct4 only; not proxied)
  ├── /v MOJO deep-link (302 → jettmojo://verify?s=…)
  ├── AARON proxy → aaron.jettoptics.ai (ungated attestation / x402/v1 / orphan)
  └── HEDGEHOG MCP → mcp.jettoptics.ai handlers
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
- CORS: `getCorsHeaders` reflects `Access-Control-Allow-Origin` only for `CORS_PROD_DOMAINS` / `CORS_DEV_DOMAINS` (wrangler allowlist). Missing or foreign Origins omit ACAO (never `*`). Never pair `Access-Control-Allow-Credentials: true` with `*`.
- SuperGrok custom connectors use OAuth 2.1 (PKCE S256, DCR) on `/joe/hedgehog`; those tokens never authorize ore / mesh / x402 / faucet  
- SuperGrok Approve CSRF is a hidden `csrf_token` HMAC-JWT (`typ=oauth-csrf`, signed with `MCP_OAUTH_SIGNING_KEY` or `MCP_API_KEY`). Cookie-absent POST + valid signed form succeeds; cookie-only / forged / expired / mismatched `client_id`|`redirect_uri`|`state` fail. Best-effort `JOE_OAUTH_CSRF` is `Path=/oauth` host-only (`mcp.jettoptics.ai`, never `.jettoptics.ai`).
- AARON proxy paths (including `/x402/v1/*`) remain ungated at the edge; origin enforces payment/auth. Catalog `GET /x402` stays faucet `payTo` `5ct4…` / `jtxfaucet.sol` — do not flip payTo or add Stripe here.
- Emergency edge kill-switch: `/faucet/claim` and `/faucet/sol` (and exact `/docs`, `/redoc`, `/openapi.json`) return 401 and never proxy. Zone routes are path-exact — the rest of `aaron.jettoptics.ai` stays origin. Durable auth-gate belongs on joe-aaron-router.
- Emergency leftover-mutator kill-switch: `/jett/totp/enroll` (and verify / gaze/analyze / claim / handshake start+done / hermesync/pair / challenge/scanned / audit/devnet) return 401 and never proxy. `/session`, `/jett/totp/challenge`, `/jett/challenge/create` stay origin/bootstrap.
- SHIELD4 X OAuth allowlist lives in Worker secret `SHIELD4_ALLOWLIST_JSON` (fail-closed when empty)  
- Report vulnerabilities: **joe@jettoptics.ai** (see [SECURITY.md](./SECURITY.md))  
- On-chain upgrade authority: Squads vault `9Wss…` — see [on-chain addresses](https://jettoptx.dev/docs/getting-started/on-chain-addresses)
