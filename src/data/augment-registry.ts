/**
 * Inline augment registry for edge worker (canonical source: @jettoptx/jett-augment-registry).
 * Keep in sync with jettoptx-sdk/packages/jett-augment-registry/augment-topology.json
 */

export interface AugmentEntry {
  digit: string;
  name: string;
  heat: string | null;
  agt: string | null;
  role: string;
  dojoGated: boolean;
}

export const JETT_AUGMENTS: AugmentEntry[] = [
  { digit: "00", name: "Core", heat: null, agt: null, role: "Session homeostasis, identity hub", dojoGated: false },
  { digit: "01", name: "Vision", heat: "V", agt: "COG", role: "Gaze-model control, JETT-Joule", dojoGated: false },
  { digit: "02", name: "Send", heat: "S", agt: "EMO", role: "Outbound messaging, #JTX room", dojoGated: false },
  { digit: "03", name: "Warp", heat: "W", agt: "ENV", role: "MOA routing, averageJOE mesh", dojoGated: false },
  { digit: "04", name: "Shield", heat: "S", agt: "COG", role: "SHIELD4 OAuth, gaze verify", dojoGated: false },
  { digit: "05", name: "Vibe", heat: "V", agt: "EMO", role: "AstroJOE personality, social hub", dojoGated: false },
  { digit: "06", name: "Search", heat: "S", agt: "ENV", role: "Discovery, diagnostics, MCP search", dojoGated: false },
  { digit: "07", name: "Weights", heat: "W", agt: "COG", role: "Grok gateway, AGT calibration", dojoGated: false },
  { digit: "08", name: "Wealth", heat: "W", agt: "EMO", role: "WEALTH8 billing, JTX, Stripe", dojoGated: false },
  { digit: "09", name: "Vector", heat: "V", agt: "ENV", role: "Swarm, SGL compute containers", dojoGated: true },
];

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

export function executeMcpTool(name: string, _args: Record<string, unknown>): unknown {
  switch (name) {
    case "hedgehog_health":
      return {
        status: "ok",
        gateway: "jettoptx-aaron-hedgehog",
        timestamp: new Date().toISOString(),
      };
    case "jett_augment_status":
      return augmentStatusPayload();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
