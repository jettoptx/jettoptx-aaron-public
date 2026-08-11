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
