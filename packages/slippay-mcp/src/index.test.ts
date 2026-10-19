import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "./index.ts";
import { z } from "zod";

describe("SlipPay MCP Server Role Gate & Capability Membrane", () => {
  const originalEnv = process.env.SLIPPAY_ROLE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SLIPPAY_ROLE;
    } else {
      process.env.SLIPPAY_ROLE = originalEnv;
    }
  });

  function getTools(server: ReturnType<typeof createServer>): Map<string, any> {
    const raw = (server as any)._registeredTools;
    return new Map(Object.entries(raw || {}));
  }

  it("default role (no env) registers only non-privileged verbs and shields all privileged verbs", () => {
    delete process.env.SLIPPAY_ROLE;
    const server = createServer();
    const tools = getTools(server);

    // Non-privileged surface (membrane principle)
    expect(tools.has("slippay_verify")).toBe(true);
    expect(tools.has("slippay_whoami")).toBe(true);
    expect(tools.has("slippay_charge_attested")).toBe(true);
    expect(tools.has("slippay_status")).toBe(true);

    // Privileged surface must be strictly absent
    expect(tools.has("slippay_pay")).toBe(false);
    expect(tools.has("slippay_subscribe")).toBe(false);
    expect(tools.has("slippay_approve")).toBe(false);
    expect(tools.has("slippay_autocharge")).toBe(false);
    expect(tools.has("slippay_arm_gate")).toBe(false);
    expect(tools.size).toBe(4);
  });

  it("explicit role=agent registers only the 4 unprivileged tools", () => {
    const server = createServer({ role: "agent" });
    const tools = getTools(server);

    expect(tools.size).toBe(4);
    expect(Array.from(tools.keys()).sort()).toEqual([
      "slippay_charge_attested",
      "slippay_status",
      "slippay_verify",
      "slippay_whoami",
    ]);
  });

  it("arbitrary/unrecognized role fails closed and defaults to unprivileged agent surface", () => {
    const server = createServer({ role: "attacker" });
    const tools = getTools(server);

    expect(tools.size).toBe(4);
    expect(tools.has("slippay_pay")).toBe(false);
    expect(tools.has("slippay_subscribe")).toBe(false);
    expect(tools.has("slippay_approve")).toBe(false);
    expect(tools.has("slippay_autocharge")).toBe(false);
    expect(tools.has("slippay_arm_gate")).toBe(false);
  });

  it("role=principal exposes all 9 tools including privileged payment and administration verbs", () => {
    const server = createServer({ role: "principal" });
    const tools = getTools(server);

    expect(tools.size).toBe(9);
    expect(Array.from(tools.keys()).sort()).toEqual([
      "slippay_approve",
      "slippay_arm_gate",
      "slippay_autocharge",
      "slippay_charge_attested",
      "slippay_pay",
      "slippay_status",
      "slippay_subscribe",
      "slippay_verify",
      "slippay_whoami",
    ]);
  });

  it("case-insensitive role handling accepts 'Principal' and 'PRINCIPAL'", () => {
    const s1 = createServer({ role: "Principal" });
    expect(getTools(s1).has("slippay_pay")).toBe(true);

    const s2 = createServer({ role: "PRINCIPAL" });
    expect(getTools(s2).has("slippay_pay")).toBe(true);
  });
});

describe("SlipPay MCP Tool Input Schema Bounds", () => {
  const principalServer = createServer({ role: "principal" });
  const tools = (principalServer as any)._registeredTools;

  function getSchema(toolName: string): z.ZodObject<any> {
    const tool = tools[toolName];
    if (!tool || !tool.inputSchema) throw new Error(`Tool ${toolName} has no inputSchema`);
    return tool.inputSchema;
  }

  describe("slippay_subscribe input schema", () => {
    const schema = getSchema("slippay_subscribe");

    it("enforces period_seconds >= 86400 (minimum 1 day cycle)", () => {
      // Below 86400 must fail
      const under = schema.safeParse({
        merchant: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "9.00",
        period_seconds: 86399,
      });
      expect(under.success).toBe(false);

      const zero = schema.safeParse({
        merchant: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "9.00",
        period_seconds: 0,
      });
      expect(zero.success).toBe(false);

      // Float period must fail
      const floatVal = schema.safeParse({
        merchant: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "9.00",
        period_seconds: 86400.5,
      });
      expect(floatVal.success).toBe(false);

      // Exactly 86400 and higher must pass
      const exact = schema.safeParse({
        merchant: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "9.00",
        period_seconds: 86400,
      });
      expect(exact.success).toBe(true);
      if (exact.success) {
        expect(exact.data.max_periods).toBe(0);
        expect(exact.data.expires_at).toBe(0);
      }
    });

    it("enforces non-negative integer bounds on max_periods and expires_at", () => {
      const negativeMax = schema.safeParse({
        merchant: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "9.00",
        period_seconds: 86400,
        max_periods: -1,
      });
      expect(negativeMax.success).toBe(false);

      const negativeExpiry = schema.safeParse({
        merchant: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "9.00",
        period_seconds: 86400,
        expires_at: -100,
      });
      expect(negativeExpiry.success).toBe(false);
    });

    it("requires merchant and amount strings", () => {
      const missingMerchant = schema.safeParse({
        amount: "9.00",
        period_seconds: 86400,
      });
      expect(missingMerchant.success).toBe(false);

      const missingAmount = schema.safeParse({
        merchant: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        period_seconds: 86400,
      });
      expect(missingAmount.success).toBe(false);
    });
  });

  describe("slippay_pay input schema", () => {
    const schema = getSchema("slippay_pay");

    it("requires recipient and amount, defaults asset to USDC", () => {
      const missing = schema.safeParse({});
      expect(missing.success).toBe(false);

      const validDefault = schema.safeParse({
        recipient: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "1.50",
      });
      expect(validDefault.success).toBe(true);
      if (validDefault.success) {
        expect(validDefault.data.asset).toBe("USDC");
      }

      const customAsset = schema.safeParse({
        recipient: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amount: "10.00",
        asset: "PYUSD",
      });
      expect(customAsset.success).toBe(true);
      if (customAsset.success) {
        expect(customAsset.data.asset).toBe("PYUSD");
      }
    });
  });

  describe("slippay_approve input schema", () => {
    const schema = getSchema("slippay_approve");

    it("requires amount and integer expiration_ledger", () => {
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse({ amount: "100.00" }).success).toBe(false);
      expect(schema.safeParse({ amount: "100.00", expiration_ledger: 12.34 }).success).toBe(false);
      expect(schema.safeParse({ amount: "100.00", expiration_ledger: 500000 }).success).toBe(true);
    });
  });

  describe("slippay_charge_attested input schema", () => {
    const schema = getSchema("slippay_charge_attested");

    it("requires subscription_id, integer not_after, and signature string", () => {
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse({
        subscription_id: "01".repeat(32),
        not_after: 1718000000.5,
        signature: "aa".repeat(64),
      }).success).toBe(false);

      const valid = schema.safeParse({
        subscription_id: "01".repeat(32),
        not_after: 1718000000,
        signature: "aa".repeat(64),
      });
      expect(valid.success).toBe(true);
    });
  });

  describe("slippay_arm_gate input schema", () => {
    const schema = getSchema("slippay_arm_gate");

    it("requires subscription_id and attester_pubkey", () => {
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse({ subscription_id: "01".repeat(32) }).success).toBe(false);
      expect(schema.safeParse({
        subscription_id: "01".repeat(32),
        attester_pubkey: "bb".repeat(32),
      }).success).toBe(true);
    });
  });

  describe("slippay_status input schema", () => {
    const schema = getSchema("slippay_status");

    it("requires hash string", () => {
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse({ hash: "a".repeat(64) }).success).toBe(true);
    });
  });

  describe("slippay_verify input schema", () => {
    const schema = getSchema("slippay_verify");

    it("requires certificate and spec strings", () => {
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse({ certificate: "{}" }).success).toBe(false);
      expect(schema.safeParse({ certificate: "{}", spec: "agent A {}" }).success).toBe(true);
    });
  });
});
