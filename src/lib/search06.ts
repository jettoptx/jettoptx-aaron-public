/**
 * search06 (JETT Augment 06 Search) — edge-safe discovery + diagnostics tools.
 * Uses public docs search APIs; no Jetson mesh or new secrets required.
 */

import type { GatewayEnv } from "./cors";
import { JETT_AUGMENTS, type AugmentEntry } from "../data/jett-augments";

const DOCS_BASE = "https://docs.jettoptx.dev";
const DOCS_SEARCH_ENDPOINTS = [
  `${DOCS_BASE}/api/search`,
  "https://www.jettoptx.dev/api/search",
];

const FETCH_TIMEOUT_MS = 4_000;
const DIAGNOSE_PROBE_TIMEOUT_MS = 3_000;
const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 20;

/** Curated fallback when public Fumadocs `/api/search` is unreachable. */
const STATIC_DOC_INDEX: Array<{ title: string; url: string; snippet: string; tags: string[] }> = [
  {
    title: "Edge Gateway",
    url: `${DOCS_BASE}/docs/infrastructure/edge-gateway`,
    snippet: "Public Cloudflare Worker fronting AARON attestation and HEDGEHOG MCP.",
    tags: ["edge", "gateway", "mcp", "aaron", "hedgehog", "cloudflare", "worker"],
  },
  {
    title: "Protocol",
    url: `${DOCS_BASE}/docs/protocol`,
    snippet: "OPTX protocol overview for agents, attestation, and JOE surfaces.",
    tags: ["protocol", "optx", "joe", "agents"],
  },
  {
    title: "On-chain addresses",
    url: `${DOCS_BASE}/docs/getting-started/on-chain-addresses`,
    snippet: "Solana program IDs, mints, and vault addresses for Jett Optics.",
    tags: ["solana", "on-chain", "addresses", "jtx", "poa"],
  },
  {
    title: "API Reference",
    url: `${DOCS_BASE}/docs/reference/api`,
    snippet: "HTTP and system endpoint reference for gateway and related services.",
    tags: ["api", "reference", "http", "gateway"],
  },
  {
    title: "Architecture — Swarm DAG",
    url: `${DOCS_BASE}/docs/architecture/swarm-dag`,
    snippet: "Swarm decomposition and agent topology notes.",
    tags: ["architecture", "swarm", "dag", "agents"],
  },
  {
    title: "Changelog",
    url: `${DOCS_BASE}/docs/reference/changelog`,
    snippet: "Release notes including edge gateway and HEDGEHOG changes.",
    tags: ["changelog", "release", "edge", "hedgehog"],
  },
  {
    title: "Getting started",
    url: `${DOCS_BASE}/docs/getting-started`,
    snippet: "Entry path for developers integrating with OPTX / JOE.",
    tags: ["getting-started", "docs", "onboarding"],
  },
];

export interface DocsSearchHit {
  title: string;
  url: string;
  snippet: string;
  type?: string;
  breadcrumbs?: string[];
}

interface FumadocsHit {
  id?: string;
  type?: string;
  content?: string;
  url?: string;
  breadcrumbs?: string[];
}

/** search06 tools implemented on this edge (plus shared registry listing). */
export const SEARCH06_EDGE_TOOLS = [
  "jett_docs_search",
  "jett_augment_lookup",
  "jett_edge_diagnose",
  "jett_augment_status",
] as const;

function stripMarks(html: string): string {
  return html.replace(/<\/?mark>/gi, "").replace(/\s+/g, " ").trim();
}

function clampLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SEARCH_LIMIT;
  return Math.min(Math.floor(n), MAX_SEARCH_LIMIT);
}

function absoluteDocsUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  if (pathOrUrl.startsWith("/")) return `${DOCS_BASE}${pathOrUrl}`;
  return `${DOCS_BASE}/${pathOrUrl}`;
}

function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function normalizeFumadocsHits(data: FumadocsHit[], limit: number): DocsSearchHit[] {
  const hits: DocsSearchHit[] = [];
  const seen = new Set<string>();

  for (const item of data) {
    if (!item?.url || !item?.content) continue;
    const url = absoluteDocsUrl(item.url);
    const snippet = stripMarks(item.content).slice(0, 280);
    const title =
      item.type === "page"
        ? snippet
        : (item.breadcrumbs?.slice(-1)[0] ?? item.id ?? url);

    const key = `${url}::${snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);

    hits.push({
      title: String(title).slice(0, 160),
      url,
      snippet,
      type: item.type,
      breadcrumbs: item.breadcrumbs,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

function searchStaticIndex(query: string, limit: number): DocsSearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = STATIC_DOC_INDEX.map((doc) => {
    const hay = `${doc.title} ${doc.snippet} ${doc.tags.join(" ")}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (hay.includes(t)) score += 1;
      if (doc.title.toLowerCase().includes(t)) score += 2;
    }
    return { doc, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ doc }) => ({
    title: doc.title,
    url: doc.url,
    snippet: doc.snippet,
    type: "static",
  }));
}

export async function jettDocsSearch(args: Record<string, unknown>): Promise<unknown> {
  const query = String(args.query ?? args.q ?? "").trim().slice(0, 200);
  const limit = clampLimit(args.limit);
  if (!query) {
    return { ok: false, error: "query is required (string, max 200 chars)", results: [] };
  }

  for (const endpoint of DOCS_SEARCH_ENDPOINTS) {
    try {
      const url = `${endpoint}?query=${encodeURIComponent(query)}`;
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) continue;
      const results = normalizeFumadocsHits(data as FumadocsHit[], limit);
      return {
        ok: true,
        augment: "06",
        tool: "jett_docs_search",
        source: endpoint,
        query,
        count: results.length,
        results,
      };
    } catch {
      /* try next endpoint */
    }
  }

  const results = searchStaticIndex(query, limit);
  return {
    ok: true,
    augment: "06",
    tool: "jett_docs_search",
    source: "static-index",
    query,
    count: results.length,
    results,
    note: "Public docs search API unreachable; returned curated static index matches.",
  };
}

function matchAugment(query: string): AugmentEntry | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;

  if (/^\d{1,2}$/.test(q)) {
    const padded = q.padStart(2, "0");
    const byDigit = JETT_AUGMENTS.find((a) => a.digit === padded);
    if (byDigit) return byDigit;
  }

  return JETT_AUGMENTS.find(
    (a) =>
      a.name.toLowerCase() === q ||
      a.digit === q ||
      a.role.toLowerCase().includes(q) ||
      (a.heat !== null && a.heat.toLowerCase() === q) ||
      (a.agt !== null && a.agt.toLowerCase() === q),
  );
}

export function jettAugmentLookup(args: Record<string, unknown>): unknown {
  const raw = String(args.digit ?? args.name ?? args.query ?? args.id ?? "").trim();
  if (!raw) {
    return {
      ok: false,
      error: "Provide digit (e.g. \"06\") or name (e.g. \"Search\")",
      augments: JETT_AUGMENTS.map((a) => ({ digit: a.digit, name: a.name })),
    };
  }

  const found = matchAugment(raw);
  if (!found) {
    return {
      ok: false,
      error: `No augment matching ${JSON.stringify(raw)}`,
      known: JETT_AUGMENTS.map((a) => ({ digit: a.digit, name: a.name })),
    };
  }

  const edgeTools =
    found.digit === "06"
      ? [...SEARCH06_EDGE_TOOLS]
      : found.digit === "00"
        ? ["hedgehog_health", "jett_augment_status"]
        : [];

  return {
    ok: true,
    tool: "jett_augment_lookup",
    augment: {
      id: parseInt(found.digit, 10),
      digit: found.digit,
      name: found.name.toUpperCase(),
      heat: found.heat,
      agt: found.agt,
      role: found.role,
      dojoGated: found.dojoGated,
      /** Topology registration only — not a live mesh health probe. */
      status: "registered" as const,
      edgeToolsImplemented: edgeTools,
    },
  };
}

interface OriginProbe {
  name: string;
  url: string;
  ok: boolean;
  status?: number;
  ms?: number;
  error?: string;
}

async function probeUrl(name: string, url: string, method: "GET" | "HEAD" = "GET"): Promise<OriginProbe> {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(url, DIAGNOSE_PROBE_TIMEOUT_MS, {
      method,
      redirect: "follow",
      headers: { Accept: "application/json, text/plain, */*" },
    });
    if (method === "GET") {
      try {
        await res.arrayBuffer();
      } catch {
        /* ignore truncated bodies */
      }
    }
    return {
      name,
      url,
      ok: res.status > 0 && res.status < 500,
      status: res.status,
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      name,
      url,
      ok: false,
      ms: Date.now() - started,
      error: err instanceof Error ? err.name : "fetch_failed",
    };
  }
}

function joinOriginPath(origin: string, path: string): string {
  try {
    return new URL(path, origin.endsWith("/") ? origin : `${origin}/`).toString();
  } catch {
    return `${origin.replace(/\/$/, "")}${path}`;
  }
}

function safeHost(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

export async function jettEdgeDiagnose(
  args: Record<string, unknown>,
  env: GatewayEnv,
  mcpToolNames: string[],
): Promise<unknown> {
  const probe = args.probe !== false && args.probe !== "false";

  const hosts = {
    aaronOrigin: env.AARON_ORIGIN || null,
    hedgehogOrigin: env.HEDGEHOG_ORIGIN || null,
    spacetimeHttpConfigured: Boolean(env.SPACETIME_HTTP_URL?.trim()),
    spacetimeHost: safeHost(env.SPACETIME_HTTP_URL),
    env: env.ENV || null,
    docsSearch: DOCS_SEARCH_ENDPOINTS[0],
    mcpRoute: "mcp.jettoptics.ai/*",
  };

  const configFlags = {
    mcpApiKeyConfigured: Boolean(env.MCP_API_KEY?.trim()),
    heliusRpcConfigured: Boolean(env.HELIUS_MAINNET_RPC?.trim()),
  };

  const probes: OriginProbe[] = [];
  if (probe) {
    if (env.AARON_ORIGIN) {
      probes.push(await probeUrl("aaron_origin", joinOriginPath(env.AARON_ORIGIN, "/"), "GET"));
    }
    if (env.HEDGEHOG_ORIGIN) {
      probes.push(await probeUrl("hedgehog_origin", joinOriginPath(env.HEDGEHOG_ORIGIN, "/"), "GET"));
    }
    probes.push(await probeUrl("docs_search", `${DOCS_SEARCH_ENDPOINTS[0]}?query=edge`, "GET"));
  }

  return {
    ok: true,
    augment: "06",
    tool: "jett_edge_diagnose",
    gateway: "jettoptx-aaron-hedgehog",
    timestamp: new Date().toISOString(),
    hosts,
    configFlags,
    mcpTools: mcpToolNames,
    search06Tools: [...SEARCH06_EDGE_TOOLS],
    probes: probe ? probes : [],
    note: probe
      ? "Origin probes use short timeouts; 5xx/unreachable is reported without secret material."
      : "Probes skipped (probe=false).",
  };
}
