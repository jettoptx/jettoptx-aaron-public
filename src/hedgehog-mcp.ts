/**
 * HEDGEHOG MCP edge handler.
 * Includes search06 discovery/diagnostics tools (docs search, augment lookup, edge diagnose).
 * SSE streaming + Jetson :8811 proxy remain future work.
 */

import type { GatewayEnv } from "./lib/cors";
import { getCorsHeaders, jsonResponse } from "./lib/cors";
import { MCP_TOOLS, executeMcpTool, augmentStatusPayload } from "./data/augment-registry";

export function isHedgehogPath(pathname: string): boolean {
  return (
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/") ||
    pathname === "/health" ||
    pathname === "/.well-known/joe-gateway"
  );
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
        auth: "JOE API token via Authorization: Bearer or X-JOE-Token — issue at jettoptx.chat/support",
        augments: "00–09 JETT Augments",
        search06Tools: ["jett_docs_search", "jett_augment_lookup", "jett_edge_diagnose"],
        docs: "https://docs.jettoptx.dev",
      },
      200,
      cors,
      requestId,
    );
  }

  // MCP JSON-RPC (Phase 0 — synchronous stub; Phase 1 adds SSE stream)
  if (url.pathname === "/mcp" && request.method === "POST") {
    let body: { jsonrpc?: string; id?: number; method?: string; params?: Record<string, unknown> };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, cors, requestId);
    }

    const { method, params, id } = body;

    if (method === "initialize") {
      return jsonResponse(
        {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "jettoptx-aaron-hedgehog", version: "0.2.0" },
          },
        },
        200,
        cors,
        requestId,
      );
    }

    if (method === "tools/list") {
      return jsonResponse(
        { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } },
        200,
        cors,
        requestId,
      );
    }

    if (method === "tools/call") {
      const toolName = params?.name as string;
      const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await executeMcpTool(toolName, toolArgs, env);
        return jsonResponse(
          {
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
          },
          200,
          cors,
          requestId,
        );
      } catch (err) {
        return jsonResponse(
          {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: String(err) },
          },
          200,
          cors,
          requestId,
        );
      }
    }

    return jsonResponse(
      { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } },
      200,
      cors,
      requestId,
    );
  }

  // MCP SSE discovery (GET /mcp)
  if (url.pathname === "/mcp" && request.method === "GET") {
    const base = `${url.protocol}//${url.host}`;
    const sessionId = crypto.randomUUID();
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            `event: endpoint\ndata: ${base}/mcp?sessionId=${sessionId}\n\n`,
          ),
        );
      },
    });
    cors.set("Content-Type", "text/event-stream");
    cors.set("Cache-Control", "no-cache");
    cors.set("X-Request-ID", requestId);
    return new Response(stream, { status: 200, headers: cors });
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
