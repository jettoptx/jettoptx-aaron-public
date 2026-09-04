/**
 * Catalog GET /x402 lists faucet services only. prima_title removed.
 */
import assert from "node:assert/strict";
import {
  EXISTING_X402_SERVICES,
  FAUCET_PAY_TO,
  buildX402Catalog,
  isX402CatalogPath,
} from "./x402-catalog";

assert.equal(isX402CatalogPath("/x402"), true);
assert.equal(isX402CatalogPath("/x402/"), true);
assert.equal(isX402CatalogPath("/x402/prima_title"), false);
assert.equal(isX402CatalogPath("/x402/v1/chat"), false);

const catalog = buildX402Catalog();
assert.equal(catalog.payTo, FAUCET_PAY_TO);
const ids = catalog.services.map((s) => s.id);
assert.equal(ids.join(","), "chat,gaze_analyze,task,orphan_donate");
assert.ok(!ids.includes("prima_title"), "prima_title must not be listed");
assert.equal(EXISTING_X402_SERVICES.length, 4);
console.log("ok: GET /x402 catalog is faucet-only; prima_title gone");
