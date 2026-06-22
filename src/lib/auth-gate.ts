/**
 * JOE-issued API token gate (Phase 1) — ported from jettoptx-jettchat-app/lib/mcp-auth.ts.
 * Validates static MCP key, SpacetimeDB jtx_api_key rows, and SHIELD4 X OAuth + WEALTH8 billing.
 */

import type { GatewayEnv } from "./cors";

export interface AuthResult {
  ok: boolean;
  error?: string;
  identity?: string;
  method?: "bearer" | "api-key" | "db-key" | "x-oauth" | "public-health";
  keyId?: number;
  xUsername?: string;
  tier?: BillingTier;
  billingMethod?: "token" | "stripe" | "founder" | "api-key";
}

type BillingTier = "none" | "basic" | "mojo" | "dojo" | "spaceCowboy";

interface Shield4Account {
  twinId: string;
  wallet?: string;
  email?: string;
  founderBypass?: boolean;
}

const SHIELD4_AUTHORIZED_X_ACCOUNTS: Record<string, Shield4Account> = {
  jettoptx: {
    twinId: "josh",
    wallet: "FEUwuvXbbSYTCEhhqgAt2viTsEnromNNDsapoFvyfy3H",
    email: "jett.optics.astro.knots@gmail.com",
    founderBypass: true,
  },
};

const JTX_MINT = "9XpJiKEYzq5yDo5pJzRfjSRMPL2yPfDQXgiN7uYtBhUj";
const SPACE_COWBOYS_COLLECTION = "FFPeaPRugCzoATDhXG7ZaGk4woTBGsmHBugdpPcgi4EY";
const DEFAULT_HELIUS_RPC =
  "https://mainnet.helius-rpc.com/?api-key=98ca6456-20a8-4518-8393-1b9ee6c2b7f3";

const TIER_THRESHOLDS: { min: number; tier: BillingTier }[] = [
  { min: 1111, tier: "spaceCowboy" },
  { min: 444, tier: "dojo" },
  { min: 12, tier: "mojo" },
  { min: 1, tier: "basic" },
];

const BILLING_CACHE_TTL_MS = 10 * 60 * 1000;
const X_TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

interface BillingCacheEntry {
  tier: BillingTier;
  jtxBalance: number;
  method: "token" | "stripe" | "founder";
  expiresAt: number;
}

interface XTokenCacheEntry {
  identity: string;
  xUsername: string;
  xId: string;
  expiresAt: number;
}

interface ApiKeyRow {
  id: number;
  twin_id: string;
  name: string;
  scopes: string;
  revoked: boolean;
}

interface XUserInfo {
  id: string;
  username: string;
  name: string;
}

const billingCache = new Map<string, BillingCacheEntry>();
const xTokenCache = new Map<string, XTokenCacheEntry>();

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeMcpApiKey(raw: string | undefined): string | undefined {
  return raw?.replace(/^\uFEFF/, "").replace(/\\r\\n$/, "").trim();
}

function heliusRpc(env: GatewayEnv): string {
  return env.HELIUS_MAINNET_RPC?.trim() || DEFAULT_HELIUS_RPC;
}

async function getJtxBalance(wallet: string, env: GatewayEnv): Promise<number> {
  const rpc = heliusRpc(env);
  const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

  let totalRaw = BigInt(0);
  let decimals = 6;

  for (const program of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenAccountsByOwner",
          params: [wallet, { mint: JTX_MINT }, { encoding: "jsonParsed", commitment: "confirmed" }],
        }),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        result?: { value?: Array<{ account?: { data?: { parsed?: { info?: Record<string, unknown> } } } }> };
      };
      for (const acct of data.result?.value ?? []) {
        const info = acct.account?.data?.parsed?.info as
          | { mint?: string; tokenAmount?: { amount?: string; decimals?: number } }
          | undefined;
        if (info?.mint === JTX_MINT) {
          if (info.tokenAmount?.amount) totalRaw += BigInt(info.tokenAmount.amount);
          if (info.tokenAmount?.decimals) decimals = info.tokenAmount.decimals;
        }
      }
    } catch {
      /* try next program */
    }
  }

  return Number(totalRaw) / Math.pow(10, decimals);
}

function jtxBalanceToTier(balance: number): BillingTier {
  for (const { min, tier } of TIER_THRESHOLDS) {
    if (balance >= min) return tier;
  }
  return "none";
}

async function hasSpaceCowboyNFT(wallet: string, env: GatewayEnv): Promise<boolean> {
  try {
    const res = await fetch(heliusRpc(env), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "sc-nft-check",
        method: "getAssetsByOwner",
        params: [{
          ownerAddress: wallet,
          grouping: ["collection", SPACE_COWBOYS_COLLECTION],
          page: 1,
          limit: 1,
        }],
      }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { result?: { items?: unknown[] } };
    return (data.result?.items?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

async function checkStripeSubscription(
  twinId: string,
  spacetimeUrl: string,
): Promise<BillingTier> {
  try {
    const ownerMatch = twinId.replace(/'/g, "''");
    const sql = `SELECT * FROM memory_entry WHERE category = 'stripe_subscription' AND (owner = '${ownerMatch}' OR key = 'sub:${ownerMatch}')`;
    const res = await fetch(`${spacetimeUrl.replace(/\/$/, "")}/sql`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: sql,
    });
    if (!res.ok) return "none";

    const data = (await res.json()) as Array<{
      schema?: { elements?: Array<{ name?: { some?: string } | string }> };
      rows?: unknown[][];
    }>;
    if (!Array.isArray(data) || data.length === 0) return "none";

    const resultSet = data[0];
    const cols = (resultSet.schema?.elements ?? []).map((e) => {
      if (typeof e.name === "string") return e.name;
      if (e.name && typeof e.name === "object" && "some" in e.name) {
        return (e.name as { some?: string }).some ?? "";
      }
      return "";
    });
    const valueIdx = cols.indexOf("value");
    if (valueIdx === -1) return "none";

    for (const row of resultSet.rows ?? []) {
      try {
        const val = JSON.parse(String(row[valueIdx])) as { status?: string; tier?: string };
        if (val.status === "active" && val.tier) {
          if (["spaceCowboy", "dojo", "mojo", "basic"].includes(val.tier)) {
            return val.tier as BillingTier;
          }
        }
      } catch {
        /* skip malformed */
      }
    }
    return "none";
  } catch {
    return "none";
  }
}

async function checkBillingGate(account: Shield4Account, env: GatewayEnv): Promise<BillingCacheEntry> {
  const cacheKey = account.twinId;
  const cached = billingCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached;

  if (account.founderBypass) {
    const entry: BillingCacheEntry = {
      tier: "spaceCowboy",
      jtxBalance: Infinity,
      method: "founder",
      expiresAt: Date.now() + BILLING_CACHE_TTL_MS,
    };
    billingCache.set(cacheKey, entry);
    return entry;
  }

  const spacetimeUrl = env.SPACETIME_HTTP_URL?.trim();
  if (spacetimeUrl) {
    const stripeTier = await checkStripeSubscription(account.twinId, spacetimeUrl);
    if (stripeTier !== "none") {
      const entry: BillingCacheEntry = {
        tier: stripeTier,
        jtxBalance: 0,
        method: "stripe",
        expiresAt: Date.now() + BILLING_CACHE_TTL_MS,
      };
      billingCache.set(cacheKey, entry);
      return entry;
    }
  }

  if (account.wallet) {
    const hasNFT = await hasSpaceCowboyNFT(account.wallet, env);
    if (hasNFT) {
      const entry: BillingCacheEntry = {
        tier: "spaceCowboy",
        jtxBalance: 0,
        method: "token",
        expiresAt: Date.now() + BILLING_CACHE_TTL_MS,
      };
      billingCache.set(cacheKey, entry);
      return entry;
    }

    const balance = await getJtxBalance(account.wallet, env);
    const tier = jtxBalanceToTier(balance);
    if (tier !== "none") {
      const entry: BillingCacheEntry = {
        tier,
        jtxBalance: balance,
        method: "token",
        expiresAt: Date.now() + BILLING_CACHE_TTL_MS,
      };
      billingCache.set(cacheKey, entry);
      return entry;
    }
  }

  const entry: BillingCacheEntry = {
    tier: "none",
    jtxBalance: 0,
    method: "token",
    expiresAt: Date.now() + 60_000,
  };
  billingCache.set(cacheKey, entry);
  return entry;
}

async function validateXOAuthToken(token: string): Promise<XUserInfo | null> {
  const cached = xTokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return { id: cached.xId, username: cached.xUsername, name: cached.identity };
  }

  try {
    const res = await fetch("https://api.x.com/2/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { data?: XUserInfo };
    const user = data.data;
    if (!user?.id || !user?.username) return null;

    xTokenCache.set(token, {
      identity: user.name,
      xUsername: user.username,
      xId: user.id,
      expiresAt: Date.now() + X_TOKEN_CACHE_TTL_MS,
    });
    return user;
  } catch {
    return null;
  }
}

async function mapXUserToIdentity(xUser: XUserInfo, env: GatewayEnv): Promise<AuthResult | null> {
  const account = SHIELD4_AUTHORIZED_X_ACCOUNTS[xUser.username.toLowerCase()];
  if (!account) return null;

  const billing = await checkBillingGate(account, env);
  if (billing.tier === "none") {
    return {
      ok: false,
      error: `Access denied: @${xUser.username} has no active subscription, Space Cowboy NFT, or JTX balance. Subscribe at jettoptics.ai/pricing or hold $JTX.`,
    };
  }

  return {
    ok: true,
    identity: `joe:${account.twinId}`,
    xUsername: xUser.username,
    method: "x-oauth",
    tier: billing.tier,
    billingMethod: billing.method,
  };
}

async function validateKeyAgainstDB(keyValue: string, spacetimeUrl: string): Promise<ApiKeyRow | null> {
  const hash = await sha256(keyValue);
  const sql = `SELECT * FROM jtx_api_key WHERE key_hash = '${hash}' LIMIT 1`;

  try {
    const res = await fetch(`${spacetimeUrl.replace(/\/$/, "")}/sql`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: sql,
    });
    if (!res.ok) return null;

    const data = (await res.json()) as Array<{
      schema?: { elements?: Array<{ name?: { some?: string } | string }> };
      rows?: unknown[][];
    }>;
    if (!Array.isArray(data) || data.length === 0) return null;

    const resultSet = data[0];
    const cols = (resultSet.schema?.elements ?? []).map((e) => {
      if (typeof e.name === "string") return e.name;
      if (e.name && typeof e.name === "object" && "some" in e.name) {
        return (e.name as { some?: string }).some ?? "";
      }
      return "";
    });
    const rows = resultSet.rows ?? [];
    if (rows.length === 0) return null;

    const row = rows[0];
    const obj: Record<string, unknown> = {};
    cols.forEach((col, i) => {
      if (col) obj[col] = row[i];
    });

    const apiKey = obj as unknown as ApiKeyRow;
    if (apiKey.revoked) return null;
    return apiKey;
  } catch {
    return null;
  }
}

async function touchKeyUsage(keyId: number, spacetimeUrl: string): Promise<void> {
  try {
    await fetch(`${spacetimeUrl.replace(/\/$/, "")}/call/touch_api_key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([keyId]),
    });
  } catch {
    /* best effort */
  }
}

export async function validateJoeToken(
  request: Request,
  pathname: string,
  env: GatewayEnv,
): Promise<AuthResult> {
  if (pathname === "/health" || pathname === "/.well-known/joe-gateway") {
    return { ok: true, method: "public-health", identity: "public" };
  }

  const mcpApiKey = normalizeMcpApiKey(env.MCP_API_KEY);
  const spacetimeUrl = env.SPACETIME_HTTP_URL?.trim();
  const url = new URL(request.url);

  const authHeader = request.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);

    if (mcpApiKey && token === mcpApiKey) {
      return {
        ok: true,
        identity: "api-key",
        method: "api-key",
        tier: "spaceCowboy",
        billingMethod: "api-key",
      };
    }

    if (spacetimeUrl) {
      const dbKey = await validateKeyAgainstDB(token, spacetimeUrl);
      if (dbKey) {
        touchKeyUsage(dbKey.id, spacetimeUrl);
        return {
          ok: true,
          identity: `joe:${dbKey.twin_id}`,
          keyId: dbKey.id,
          method: "db-key",
        };
      }
    }

    const xUser = await validateXOAuthToken(token);
    if (xUser) {
      const mapped = await mapXUserToIdentity(xUser, env);
      if (mapped) return mapped;
      return {
        ok: false,
        error: `X account @${xUser.username} is not authorized for HEDGEHOG MCP access. Contact admin.`,
      };
    }
  }

  const headerKey = request.headers.get("X-JOE-Token")?.trim();
  const queryKey = url.searchParams.get("key")?.trim();
  for (const key of [headerKey, queryKey]) {
    if (!key) continue;
    if (mcpApiKey && key === mcpApiKey) {
      return { ok: true, identity: "api-key", method: "api-key", tier: "spaceCowboy", billingMethod: "api-key" };
    }
    if (spacetimeUrl) {
      const dbKey = await validateKeyAgainstDB(key, spacetimeUrl);
      if (dbKey) {
        touchKeyUsage(dbKey.id, spacetimeUrl);
        return { ok: true, identity: `joe:${dbKey.twin_id}`, keyId: dbKey.id, method: "db-key" };
      }
    }
  }

  return {
    ok: false,
    error:
      "Unauthorized — JOE API token required. Provide Bearer token (MCP API key, SpacetimeDB key, or X OAuth). Issue keys at jettoptx.chat/support.",
  };
}
