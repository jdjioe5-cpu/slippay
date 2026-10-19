import { assertEquals, assertNotEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Hono } from "hono";
import metricsRoute, {
  clearMetricsCache,
  setFetchDuneForTest,
  getSubscriptionContractId,
  getStellarNetwork,
  DEFAULT_CONTRACT_ID,
} from "../routes/metrics.ts";

function createTestApp() {
  const app = new Hono();
  app.route("/v1/metrics", metricsRoute);
  return app;
}

Deno.test("GET /v1/metrics/dune-snapshot returns honest unconfigured state when keys missing", async () => {
  clearMetricsCache();
  setFetchDuneForTest(null);

  const prevKey = Deno.env.get("DUNE_API_KEY");
  Deno.env.delete("DUNE_API_KEY");

  try {
    const app = createTestApp();
    const res = await app.request("http://localhost/v1/metrics/dune-snapshot");
    assertEquals(res.status, 200);
    const body = await res.json();

    assertEquals(body.configured, false);
    assert(typeof body.network === "string");
    assert(typeof body.contract_id === "string");
    assert(body.dashboard_url.includes("dune.com"));
    assert(body.note.includes("Dashboard not published yet"));
  } finally {
    if (prevKey) Deno.env.set("DUNE_API_KEY", prevKey);
  }
});

Deno.test("contract id and network read from configuration correctly", () => {
  const prevNet = Deno.env.get("STELLAR_NETWORK");
  const prevMainContract = Deno.env.get("SLIPPAY_SUBSCRIPTION_CONTRACT_MAINNET");
  const prevTestContract = Deno.env.get("SLIPPAY_SUBSCRIPTION_CONTRACT_TESTNET");

  try {
    Deno.env.set("STELLAR_NETWORK", "mainnet");
    Deno.env.set("SLIPPAY_SUBSCRIPTION_CONTRACT_MAINNET", "C_MAINNET_CUSTOM_ADDRESS");
    assertEquals(getStellarNetwork(), "mainnet");
    assertEquals(getSubscriptionContractId(), "C_MAINNET_CUSTOM_ADDRESS");

    Deno.env.set("STELLAR_NETWORK", "testnet");
    Deno.env.set("SLIPPAY_SUBSCRIPTION_CONTRACT_TESTNET", "C_TESTNET_CUSTOM_ADDRESS");
    assertEquals(getStellarNetwork(), "testnet");
    assertEquals(getSubscriptionContractId(), "C_TESTNET_CUSTOM_ADDRESS");

    // Falls back to DEFAULT_CONTRACT_ID if unset
    Deno.env.delete("SLIPPAY_SUBSCRIPTION_CONTRACT_TESTNET");
    assertEquals(getSubscriptionContractId(), DEFAULT_CONTRACT_ID);
  } finally {
    if (prevNet) Deno.env.set("STELLAR_NETWORK", prevNet); else Deno.env.delete("STELLAR_NETWORK");
    if (prevMainContract) Deno.env.set("SLIPPAY_SUBSCRIPTION_CONTRACT_MAINNET", prevMainContract); else Deno.env.delete("SLIPPAY_SUBSCRIPTION_CONTRACT_MAINNET");
    if (prevTestContract) Deno.env.set("SLIPPAY_SUBSCRIPTION_CONTRACT_TESTNET", prevTestContract); else Deno.env.delete("SLIPPAY_SUBSCRIPTION_CONTRACT_TESTNET");
  }
});

Deno.test("caches successful metric reads and does not freeze failed reads", async () => {
  clearMetricsCache();

  const prevKey = Deno.env.get("DUNE_API_KEY");
  const prevQActive = Deno.env.get("DUNE_Q_ACTIVE");

  Deno.env.set("DUNE_API_KEY", "test_key");
  Deno.env.set("DUNE_Q_ACTIVE", "12345");

  let callCount = 0;
  let shouldFail = true;

  setFetchDuneForTest(async (_queryId: string, _apiKey: string) => {
    callCount++;
    if (shouldFail) {
      throw new Error("Dune 504 Gateway Timeout: backend offline");
    }
    return [{ active_subs: 100 }];
  });

  try {
    const app = createTestApp();

    // 1. First call fails
    const res1 = await app.request("http://localhost/v1/metrics/dune-snapshot");
    assertEquals(res1.status, 200);
    const body1 = await res1.json();

    assertEquals(body1.configured, true);
    assertEquals(body1.metrics.active_subscriptions, { status: "unavailable" });

    // Ensure raw exception details are NOT leaked to public client
    const jsonStr1 = JSON.stringify(body1);
    assert(!jsonStr1.includes("504 Gateway Timeout"), "Must not leak raw exception strings");
    assert(!jsonStr1.includes("backend offline"), "Must not leak internal error message");
    assertEquals(callCount, 1);

    // 2. Second call after upstream recovers: should retry immediately rather than serving cached error
    shouldFail = false;
    const res2 = await app.request("http://localhost/v1/metrics/dune-snapshot");
    assertEquals(res2.status, 200);
    const body2 = await res2.json();

    assertEquals(body2.configured, true);
    assertEquals(body2.metrics.active_subscriptions, [{ active_subs: 100 }]);
    assertEquals(callCount, 2, "Failed metric must be retried on next request, not frozen in cache");

    // 3. Third call: successful read is cached, so fetcher should NOT be called again
    const res3 = await app.request("http://localhost/v1/metrics/dune-snapshot");
    assertEquals(res3.status, 200);
    const body3 = await res3.json();
    assertEquals(body3.metrics.active_subscriptions, [{ active_subs: 100 }]);
    assertEquals(callCount, 2, "Successful metric must be served from cache during TTL");
  } finally {
    clearMetricsCache();
    setFetchDuneForTest(null);
    if (prevKey) Deno.env.set("DUNE_API_KEY", prevKey); else Deno.env.delete("DUNE_API_KEY");
    if (prevQActive) Deno.env.set("DUNE_Q_ACTIVE", prevQActive); else Deno.env.delete("DUNE_Q_ACTIVE");
  }
});
