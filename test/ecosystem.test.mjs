import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  filterEnv,
  buildApiEnv,
  buildListenerEnv,
  FORWARD_PREFIXES,
} = require("../ecosystem.config.cjs");

test("PM2 ecosystem: FORWARD_PREFIXES covers relayer, ramp, metrics, and subscriptions", () => {
  const expectedPrefixes = [
    "RELAYER_",
    "ETHERFUSE_",
    "FOURP_",
    "DUNE_",
    "SLIPPAY_",
    "SOROBAN_",
    "TRUSTED_",
    "ASK_",
    "CLAUDE_",
  ];
  for (const prefix of expectedPrefixes) {
    assert(
      FORWARD_PREFIXES.includes(prefix),
      `FORWARD_PREFIXES must include ${prefix}`,
    );
  }
});

test("PM2 ecosystem: buildApiEnv forwards relayer configuration without edits", () => {
  const mockEnv = {
    RELAYER_SECRET: "SDEMOSPONSORSECRET1234567890ABCDEF",
    RELAYER_WASM_HASH: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    RELAYER_RPC: "https://custom-soroban-rpc.example.com",
    RELAYER_DAILY_FLOAT_BUDGET: "500000000",
  };
  const apiEnv = buildApiEnv(mockEnv);
  assert.equal(apiEnv.RELAYER_SECRET, mockEnv.RELAYER_SECRET);
  assert.equal(apiEnv.RELAYER_WASM_HASH, mockEnv.RELAYER_WASM_HASH);
  assert.equal(apiEnv.RELAYER_RPC, mockEnv.RELAYER_RPC);
  assert.equal(apiEnv.RELAYER_DAILY_FLOAT_BUDGET, mockEnv.RELAYER_DAILY_FLOAT_BUDGET);
});

test("PM2 ecosystem: buildApiEnv forwards ramp, metrics, and subscriptions variables", () => {
  const mockEnv = {
    // Ramp
    ETHERFUSE_API_KEY: "ef_test_key_12345",
    ETHERFUSE_ENABLED: "true",
    FOURP_API_KEY: "fourp_live_sec_67890",
    // Metrics
    DUNE_API_KEY: "dune_api_key_abcde",
    DUNE_Q_ACTIVE: "123456",
    DUNE_Q_MRR: "234567",
    // Subscriptions
    SLIPPAY_SUBSCRIPTION_CONTRACT_MAINNET: "CCONTRACT12345MAINNET",
    SLIPPAY_SUBSCRIPTION_CONTRACT_TESTNET: "CCONTRACT12345TESTNET",
    SOROBAN_RPC_TESTNET: "https://testnet.rpc.stellar.org",
    // Proxy & Rate limit
    TRUSTED_PROXY_HOPS: "2",
  };
  const apiEnv = buildApiEnv(mockEnv);

  // Ramp
  assert.equal(apiEnv.ETHERFUSE_API_KEY, "ef_test_key_12345");
  assert.equal(apiEnv.ETHERFUSE_ENABLED, "true");
  assert.equal(apiEnv.FOURP_API_KEY, "fourp_live_sec_67890");

  // Metrics
  assert.equal(apiEnv.DUNE_API_KEY, "dune_api_key_abcde");
  assert.equal(apiEnv.DUNE_Q_ACTIVE, "123456");
  assert.equal(apiEnv.DUNE_Q_MRR, "234567");

  // Subscriptions
  assert.equal(apiEnv.SLIPPAY_SUBSCRIPTION_CONTRACT_MAINNET, "CCONTRACT12345MAINNET");
  assert.equal(apiEnv.SLIPPAY_SUBSCRIPTION_CONTRACT_TESTNET, "CCONTRACT12345TESTNET");
  assert.equal(apiEnv.SOROBAN_RPC_TESTNET, "https://testnet.rpc.stellar.org");

  // Proxy
  assert.equal(apiEnv.TRUSTED_PROXY_HOPS, "2");
});

test("PM2 ecosystem: buildApiEnv and buildListenerEnv apply safe defaults", () => {
  const emptyEnv = {};
  const apiEnv = buildApiEnv(emptyEnv);
  assert.equal(apiEnv.PORT, "8080");
  assert.equal(apiEnv.SLIPPAY_DB_SCHEMA, "public");
  assert.equal(apiEnv.STELLAR_NETWORK, "TESTNET");
  assert.equal(apiEnv.CHECKOUT_BASE_URL, "https://api.slippay.cc");

  const listenerEnv = buildListenerEnv(emptyEnv);
  assert.equal(listenerEnv.NODE_ENV, "production");
  assert.equal(listenerEnv.SLIPPAY_DB_SCHEMA, "public");
  assert.equal(listenerEnv.STELLAR_NETWORK, "TESTNET");
  assert.equal(listenerEnv.MERCHANT_POLL_MS, "30000");
});
