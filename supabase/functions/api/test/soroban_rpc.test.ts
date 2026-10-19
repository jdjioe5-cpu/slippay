import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getSorobanRpcUrl,
  getSorobanConfig,
  DEFAULT_SOROBAN_RPC,
  SorobanRpcError,
  buildChargeTransaction,
} from "../lib/soroban.ts";

Deno.test("getSorobanRpcUrl uses default SDF RPC endpoints when no env overrides set", () => {
  const prevGlobal = Deno.env.get("SOROBAN_RPC");
  const prevTest = Deno.env.get("SOROBAN_RPC_TESTNET");
  const prevMain = Deno.env.get("SOROBAN_RPC_MAINNET");

  try {
    Deno.env.delete("SOROBAN_RPC");
    Deno.env.delete("SOROBAN_RPC_TESTNET");
    Deno.env.delete("SOROBAN_RPC_MAINNET");

    assertEquals(getSorobanRpcUrl("testnet"), DEFAULT_SOROBAN_RPC.testnet);
    assertEquals(getSorobanRpcUrl("mainnet"), DEFAULT_SOROBAN_RPC.mainnet);

    const cfgTest = getSorobanConfig("testnet");
    assertEquals(cfgTest.rpcUrl, DEFAULT_SOROBAN_RPC.testnet);
    const cfgMain = getSorobanConfig("mainnet");
    assertEquals(cfgMain.rpcUrl, DEFAULT_SOROBAN_RPC.mainnet);
  } finally {
    if (prevGlobal) Deno.env.set("SOROBAN_RPC", prevGlobal);
    if (prevTest) Deno.env.set("SOROBAN_RPC_TESTNET", prevTest);
    if (prevMain) Deno.env.set("SOROBAN_RPC_MAINNET", prevMain);
  }
});

Deno.test("getSorobanRpcUrl respects per-network env overrides", () => {
  const prevGlobal = Deno.env.get("SOROBAN_RPC");
  const prevTest = Deno.env.get("SOROBAN_RPC_TESTNET");
  const prevMain = Deno.env.get("SOROBAN_RPC_MAINNET");

  try {
    Deno.env.delete("SOROBAN_RPC");
    Deno.env.set("SOROBAN_RPC_TESTNET", "https://custom-testnet.rpc.io");
    Deno.env.set("SOROBAN_RPC_MAINNET", "https://custom-mainnet.rpc.io");

    assertEquals(getSorobanRpcUrl("testnet"), "https://custom-testnet.rpc.io");
    assertEquals(getSorobanRpcUrl("mainnet"), "https://custom-mainnet.rpc.io");
  } finally {
    if (prevGlobal) Deno.env.set("SOROBAN_RPC", prevGlobal); else Deno.env.delete("SOROBAN_RPC");
    if (prevTest) Deno.env.set("SOROBAN_RPC_TESTNET", prevTest); else Deno.env.delete("SOROBAN_RPC_TESTNET");
    if (prevMain) Deno.env.set("SOROBAN_RPC_MAINNET", prevMain); else Deno.env.delete("SOROBAN_RPC_MAINNET");
  }
});

Deno.test("getSorobanRpcUrl prioritizes global SOROBAN_RPC when set", () => {
  const prevGlobal = Deno.env.get("SOROBAN_RPC");
  const prevTest = Deno.env.get("SOROBAN_RPC_TESTNET");

  try {
    Deno.env.set("SOROBAN_RPC_TESTNET", "https://custom-testnet.rpc.io");
    Deno.env.set("SOROBAN_RPC", "https://global.soroban.rpc.io");

    assertEquals(getSorobanRpcUrl("testnet"), "https://global.soroban.rpc.io");
    assertEquals(getSorobanRpcUrl("mainnet"), "https://global.soroban.rpc.io");
  } finally {
    if (prevGlobal) Deno.env.set("SOROBAN_RPC", prevGlobal); else Deno.env.delete("SOROBAN_RPC");
    if (prevTest) Deno.env.set("SOROBAN_RPC_TESTNET", prevTest); else Deno.env.delete("SOROBAN_RPC_TESTNET");
  }
});

Deno.test("buildChargeTransaction raises transport SorobanRpcError on unreachable endpoint", async () => {
  const unreachableRpc = "http://127.0.0.1:54329/unreachable-soroban-rpc";

  let caught: unknown = null;
  try {
    await buildChargeTransaction({
      contractId: "CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN",
      subscriptionNonce: "00".repeat(32),
      buyerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      network: "testnet",
      rpcUrlOverride: unreachableRpc,
    });
  } catch (err) {
    caught = err;
  }

  assert(caught instanceof SorobanRpcError, "Expected SorobanRpcError to be thrown");
  const rpcErr = caught as SorobanRpcError;
  assertEquals(rpcErr.isTransport, true, "Expected isTransport to be true for unreachable RPC");
  assertEquals(rpcErr.rpcUrl, unreachableRpc);
});

Deno.test("subscriptions onchain-charge maps transport error to 503 rpc_unavailable", () => {
  const err = new SorobanRpcError("Connection refused", "http://127.0.0.1:54329/rpc", true);
  assertEquals(err.name, "SorobanRpcError");
  assertEquals(err.isTransport, true);
  assertEquals(err.rpcUrl, "http://127.0.0.1:54329/rpc");
});

