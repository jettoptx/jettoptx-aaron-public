/**
 * MCP tool registry + dispatch for the HEDGEHOG edge worker.
 * Augment topology: ./jett-augments.ts · search06 tools: ../lib/search06.ts
 */

import type { GatewayEnv } from "../lib/cors";
import { executeMessageJoe, MESSAGE_JOE_TOOL_NAME } from "../lib/message-joe";
import {
  jettAugmentLookup,
  jettDocsSearch,
  jettEdgeDiagnose,
} from "../lib/search06";
import { JETT_AUGMENTS } from "./jett-augments";

export type { AugmentEntry } from "./jett-augments";
export { JETT_AUGMENTS } from "./jett-augments";

/** MCP tools this edge Worker actually implements (not a full augment runtime). */
export const MCP_TOOLS = [
  {
    name: "hedgehog_health",
    description: "Check HEDGEHOG + AARON edge gateway health",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "jett_augment_status",
    description: "List all JETT Augments 00–09 with HEAT hotkeys (V/S/W) and AGT lobes",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "jett_docs_search",
    description:
      "search06: Search OPTX docs via GET docs.jettoptx.dev/api/search?query= (Fumadocs). Returns titles, absolute docs.jettoptx.dev URLs, and snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search term (mapped to HTTP ?query= — not ?q=, which returns empty)",
        },
        limit: { type: "number", description: "Max results (default 8, max 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "jett_augment_lookup",
    description:
      "search06: Look up one JETT Augment by digit or name (role, HEAT, AGT). Status is registry registration, not live health.",
    inputSchema: {
      type: "object",
      properties: {
        digit: { type: "string", description: "Augment digit, e.g. \"06\"" },
        name: { type: "string", description: "Augment name, e.g. \"Search\"" },
      },
    },
  },
  {
    name: "jett_edge_diagnose",
    description:
      "search06: Edge diagnostics — configured hosts, MCP tool list, optional origin/docs probes. Does not leak secrets.",
    inputSchema: {
      type: "object",
      properties: {
        probe: {
          type: "boolean",
          description: "If true (default), GET probe AARON/HEDGEHOG origins and docs search with short timeouts",
        },
      },
    },
  },
  {
    name: MESSAGE_JOE_TOOL_NAME,
    description:
      "Text-only accept-and-ack to Joe. Sends a message string and returns an ack. No mesh keys. If the inbox webhook secrets are set the text is POSTed; if unset the message is still accepted and Joe is not woken.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Plain text for Joe (no files, images, or mesh credentials)",
        },
      },
      required: ["message"],
    },
  },
];

/**
 * Registry listing for MCP `jett_augment_status`.
 * Status is `"registered"` (topology known to this edge), not a live health probe.
 * This Worker only implements the tools in `MCP_TOOLS`.
 */
export function augmentStatusPayload() {
  return {
    gateway: "jettoptx-aaron-hedgehog",
    version: "0.2.0",
    augments: JETT_AUGMENTS.map((a) => ({
      id: parseInt(a.digit, 10),
      ...a,
      name: a.name.toUpperCase(),
      status: "registered" as const,
    })),
    edgeMcpTools: MCP_TOOLS.map((t) => t.name),
    matrixRooms: {
      public: "#JTX:jettoptics.ai",
      adminRail: "#optx:jettoptics.ai",
    },
  };
}

export async function executeMcpTool(
  name: string,
  args: Record<string, unknown>,
  env: GatewayEnv,
): Promise<unknown> {
  switch (name) {
    case "hedgehog_health":
      return {
        status: "ok",
        gateway: "jettoptx-aaron-hedgehog",
        timestamp: new Date().toISOString(),
        mcpTools: MCP_TOOLS.map((t) => t.name),
      };
    case "jett_augment_status":
      return augmentStatusPayload();
    case "jett_docs_search":
      return jettDocsSearch(args);
    case "jett_augment_lookup":
      return jettAugmentLookup(args);
    case "jett_edge_diagnose":
      return jettEdgeDiagnose(
        args,
        env,
        MCP_TOOLS.map((t) => t.name),
      );
    case MESSAGE_JOE_TOOL_NAME:
      return executeMessageJoe(args, env);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
