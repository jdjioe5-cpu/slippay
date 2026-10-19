import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getOptionalFeaturesStatus, logOptionalFeaturesStatus } from "../index.ts";
import app from "../index.ts";

Deno.test("API optional features: getOptionalFeaturesStatus reports status and disable reasons", () => {
  // Clear optional feature env vars
  Deno.env.delete("RELAYER_SECRET");
  Deno.env.delete("RELAYER_WASM_HASH");
  Deno.env.delete("ETHERFUSE_API_KEY");
  Deno.env.delete("FOURP_API_KEY");
  Deno.env.delete("DUNE_API_KEY");
  Deno.env.delete("SLIPPAY_SUBSCRIPTION_CONTRACT_MAINNET");
  Deno.env.delete("SLIPPAY_SUBSCRIPTION_CONTRACT_TESTNET");

  const statuses = getOptionalFeaturesStatus();
  const relayerStatus = statuses.find((s) => s.feature === "relayer");
  assert(relayerStatus, "must report relayer status");
  assertEquals(relayerStatus.enabled, false);
  assertEquals(relayerStatus.reason, "RELAYER_SECRET not configured");

  const etherfuseStatus = statuses.find((s) => s.feature === "etherfuse_ramp");
  assert(etherfuseStatus, "must report etherfuse_ramp status");
  assertEquals(etherfuseStatus.enabled, false);
  assertEquals(etherfuseStatus.reason, "ETHERFUSE_API_KEY not configured");

  const fourpStatus = statuses.find((s) => s.feature === "fourp_ramp");
  assert(fourpStatus, "must report fourp_ramp status");
  assertEquals(fourpStatus.enabled, false);
  assertEquals(fourpStatus.reason, "FOURP_API_KEY not configured");

  const duneStatus = statuses.find((s) => s.feature === "dune_metrics");
  assert(duneStatus, "must report dune_metrics status");
  assertEquals(duneStatus.enabled, false);
  assertEquals(duneStatus.reason, "DUNE_API_KEY not configured");

  const subStatus = statuses.find((s) => s.feature === "onchain_subscriptions");
  assert(subStatus, "must report onchain_subscriptions status");
  assertEquals(subStatus.enabled, false);
  assertEquals(subStatus.reason, "SLIPPAY_SUBSCRIPTION_CONTRACT_MAINNET/TESTNET not configured");

  // When env vars are provided, status updates to enabled
  Deno.env.set("RELAYER_SECRET", "S1111111111111111111111111111111111111111111111111111111");
  Deno.env.set("RELAYER_WASM_HASH", "a".repeat(64));
  Deno.env.set("ETHERFUSE_API_KEY", "ef_key");
  Deno.env.set("FOURP_API_KEY", "fourp_key");
  Deno.env.set("DUNE_API_KEY", "dune_key");
  Deno.env.set("SLIPPAY_SUBSCRIPTION_CONTRACT_TESTNET", "C1111111111111111111111111111111111111111111111111111111");

  const updatedStatuses = getOptionalFeaturesStatus();
  assertEquals(updatedStatuses.find((s) => s.feature === "relayer")?.enabled, true);
  assertEquals(updatedStatuses.find((s) => s.feature === "etherfuse_ramp")?.enabled, true);
  assertEquals(updatedStatuses.find((s) => s.feature === "fourp_ramp")?.enabled, true);
  assertEquals(updatedStatuses.find((s) => s.feature === "dune_metrics")?.enabled, true);
  assertEquals(updatedStatuses.find((s) => s.feature === "onchain_subscriptions")?.enabled, true);

  // logOptionalFeaturesStatus runs without error
  logOptionalFeaturesStatus();
});

Deno.test("API optional features: GET /api/v1/features exposes feature status via HTTP", async () => {
  const req = new Request("http://localhost/api/v1/features", { method: "GET" });
  const res = await app.fetch(req);
  assertEquals(res.status, 200);
  const json = await res.json();
  assert(Array.isArray(json.features), "features must be an array");
  assert(json.features.length >= 5, "must report at least 5 optional features");
});
