/**
 * HEDGEHOG MCP edge handler.
 * Includes search06 discovery/diagnostics tools (docs search, augment lookup, edge diagnose).
 * Streamable HTTP + legacy SSE discovery. Jetson :8811 proxy remains future work.
 */

import type { GatewayEnv } from "./lib/cors";
import { getCorsHeaders, jsonResponse } from "./lib/cors";
import { MCP_TOOLS, executeMcpTool, augmentStatusPayload } from "./data/augment-registry";
import { inboxConfiguredFromEnv } from "./lib/message-joe";

const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"] as const;
type McpMethod =
  | "initialize"
  | "notifications/initialized"
  | "tools/list"
  | "tools/call"
  | "ping"
  | "resources/list"
  | "prompts/list";

function isMcpMethod(method: string): method is McpMethod {
  return (
    method === "initialize" ||
    method === "notifications/initialized" ||
    method === "tools/list" ||
    method === "tools/call" ||
    method === "ping" ||
    method === "resources/list" ||
    method === "prompts/list"
  );
}

export function isHedgehogPath(pathname: string): boolean {
  return (
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/") ||
    pathname === "/health" ||
    pathname === "/.well-known/joe-gateway"
  );
}

/**
 * Exact JettChat census path (aaron-router GET /mcp/jettchat).
 * Must be checked in index.ts BEFORE isHedgehogPath — `/mcp/` would swallow it.
 * Prefixes such as /mcp/jettchat/ are not this route.
 */
export function isJettchatCensusPath(pathname: string): boolean {
  return pathname === "/mcp/jettchat";
}

/**
 * Streamable HTTP MCP (POST JSON-RPC / GET SSE / DELETE session).
 * Path-agnostic so SuperGrok can use /joe/hedgehog after OAuth.
 */
export async function handleMcpSession(
  request: Request,
  env: GatewayEnv,
  requestId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const cors = getCorsHeaders(request, env);
  cors.set("X-Request-ID", requestId);
  cors.set("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id, X-Request-ID");

  if (request.method === "DELETE") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method === "GET") {
    return mcpSseDiscovery(url, cors, requestId);
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, cors, requestId);
  }

  let body: {
    jsonrpc?: string;
    id?: number | string | null;
    method?: string;
    params?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, cors, requestId);
  }

  const { method, params, id } = body;
  if (!method) {
    return jsonResponse(
      { jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "Missing method" } },
      400,
      cors,
      requestId,
    );
  }

  // Notifications have no id — Streamable HTTP uses 202.
  if (id === undefined || id === null) {
    return new Response(null, { status: 202, headers: cors });
  }

  if (!isMcpMethod(method)) {
    return jsonResponse(
      { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } },
      200,
      cors,
      requestId,
    );
  }

  const accept = request.headers.get("Accept") ?? "";
  const preferSse = accept.includes("text/event-stream") && !accept.includes("application/json");

  const rpc = await mcpJsonRpc(method, params ?? {}, id, env);
  if (method === "initialize") {
    cors.set("Mcp-Session-Id", crypto.randomUUID());
    cors.set("MCP-Protocol-Version", String(
      (rpc.result as { protocolVersion?: string } | undefined)?.protocolVersion ?? "2024-11-05",
    ));
  }

  if (preferSse) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(rpc)}\n\n`));
        controller.close();
      },
    });
    cors.set("Content-Type", "text/event-stream");
    cors.set("Cache-Control", "no-cache");
    return new Response(stream, { status: 200, headers: cors });
  }

  return jsonResponse(rpc, 200, cors, requestId);
}

async function mcpJsonRpc(
  method: McpMethod,
  params: Record<string, unknown>,
  id: number | string,
  env: GatewayEnv,
): Promise<Record<string, unknown>> {
  switch (method) {
    case "initialize": {
      const requested =
        typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (
        SUPPORTED_PROTOCOL_VERSIONS as readonly string[]
      ).includes(requested)
        ? requested
        : "2024-11-05";
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "jettoptx-aaron-hedgehog", version: "0.2.0" },
        },
      };
    }
    case "notifications/initialized":
      return { jsonrpc: "2.0", id, result: {} };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
    case "tools/call": {
      const toolName = params.name as string;
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await executeMcpTool(toolName, toolArgs, env);
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
        };
      } catch (err) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: String(err) },
        };
      }
    }
    case "resources/list":
      return { jsonrpc: "2.0", id, result: { resources: [] } };
    case "prompts/list":
      return { jsonrpc: "2.0", id, result: { prompts: [] } };
    default: {
      const _never: never = method;
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${_never}` },
      };
    }
  }
}

function mcpSseDiscovery(url: URL, cors: Headers, requestId: string): Response {
  const base = `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "") || "/mcp"}`;
  const sessionId = crypto.randomUUID();
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`event: endpoint\ndata: ${base}?sessionId=${sessionId}\n\n`));
      controller.close();
    },
  });
  cors.set("Content-Type", "text/event-stream");
  cors.set("Cache-Control", "no-cache");
  cors.set("X-Request-ID", requestId);
  return new Response(stream, { status: 200, headers: cors });
}

export async function handleHedgehog(
  request: Request,
  env: GatewayEnv,
  requestId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const cors = getCorsHeaders(request, env);

  if (url.pathname === "/health") {
    return jsonResponse(
      {
        status: "ok",
        service: "HEDGEHOG",
        gateway: "jettoptx-aaron-hedgehog",
        hedgehogOrigin: env.HEDGEHOG_ORIGIN,
        mcpTools: MCP_TOOLS.length,
        inboxConfigured: inboxConfiguredFromEnv(env),
        requestId,
      },
      200,
      cors,
      requestId,
    );
  }

  if (url.pathname === "/.well-known/joe-gateway") {
    return jsonResponse(
      {
        name: "JOE — Jett Optics Engine",
        gateway: "jettoptx-aaron-hedgehog",
        mcpEndpoint: "/mcp",
        supergrokMcp: "/joe/hedgehog",
        auth: "SuperGrok: OAuth at /joe/hedgehog (no JOE token paste). Computer: Authorization: Bearer or X-JOE-Token — issue at jettoptx.chat/support",
        augments: "00–09 JETT Augments",
        search06Tools: ["jett_docs_search", "jett_augment_lookup", "jett_edge_diagnose"],
        publicTools: MCP_TOOLS.map((t) => t.name),
        inboxConfigured: inboxConfiguredFromEnv(env),
        docs: "https://docs.jettoptx.dev",
      },
      200,
      cors,
      requestId,
    );
  }

  if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
    return handleMcpSession(request, env, requestId);
  }

  // Proxy remaining HEDGEHOG REST to Jetson origin
  if (url.pathname.startsWith("/grok") || url.pathname.startsWith("/context")) {
    const originUrl = new URL(env.HEDGEHOG_ORIGIN);
    const target = new URL(url.pathname + url.search, originUrl);
    const headers = new Headers(request.headers);
    headers.set("X-Request-ID", requestId);
    headers.delete("host");
    const res = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.body,
    });
    const responseHeaders = new Headers(res.headers);
    cors.forEach((v, k) => responseHeaders.set(k, v));
    responseHeaders.set("X-HEDGEHOG-Gateway", "jettoptx-aaron-hedgehog");
    return new Response(res.body, { status: res.status, headers: responseHeaders });
  }

  return jsonResponse({ error: "Not found", path: url.pathname }, 404, cors, requestId);
}

export { augmentStatusPayload };
