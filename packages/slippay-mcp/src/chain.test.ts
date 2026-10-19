import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  Keypair, Account, xdr, Address, Asset, Networks,
} from "@stellar/stellar-sdk";
import * as chain from "./chain.ts";

describe("SlipPay MCP Chain Engine", () => {
  const TEST_KEYPAIR = Keypair.random();
  const TEST_SECRET = TEST_KEYPAIR.secret();
  const TEST_PUBLIC = TEST_KEYPAIR.publicKey();
  const TEST_MERCHANT = Keypair.random().publicKey();
  const TEST_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SLIPPAY_SIGNER_SECRET = TEST_SECRET;
    process.env.SLIPPAY_CONTRACT = TEST_CONTRACT;
    chain.setRpcClient(null);
    chain.setHorizonClient(null);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    chain.setRpcClient(null);
    chain.setHorizonClient(null);
  });

  describe("Signer & Contract Missing Paths", () => {
    it("fails with clear descriptive error when SLIPPAY_SIGNER_SECRET is unset", async () => {
      delete process.env.SLIPPAY_SIGNER_SECRET;

      expect(() => chain.signer()).toThrow("SLIPPAY_SIGNER_SECRET not set");
      expect(() => chain.whoami()).toThrow("SLIPPAY_SIGNER_SECRET not set");

      await expect(chain.pay(TEST_MERCHANT, "1.00")).rejects.toThrow("SLIPPAY_SIGNER_SECRET not set");
      await expect(chain.subscribe(TEST_MERCHANT, "9.00", 86400)).rejects.toThrow("SLIPPAY_SIGNER_SECRET not set");
      await expect(chain.approve("100.00", 500000)).rejects.toThrow("SLIPPAY_SIGNER_SECRET not set");
      await expect(chain.autocharge("a".repeat(64))).rejects.toThrow("SLIPPAY_SIGNER_SECRET not set");
      await expect(chain.autochargeAttested("a".repeat(64), 1800000000, "b".repeat(128))).rejects.toThrow("SLIPPAY_SIGNER_SECRET not set");
      await expect(chain.armGate("a".repeat(64), "c".repeat(64))).rejects.toThrow("SLIPPAY_SIGNER_SECRET not set");
    });

    it("fails with clear descriptive error when SLIPPAY_CONTRACT is unset", async () => {
      delete process.env.SLIPPAY_CONTRACT;

      expect(() => chain.subContract()).toThrow("SLIPPAY_CONTRACT not set");
      await expect(chain.subscribe(TEST_MERCHANT, "9.00", 86400)).rejects.toThrow("SLIPPAY_CONTRACT not set");
      await expect(chain.autocharge("a".repeat(64))).rejects.toThrow("SLIPPAY_CONTRACT not set");
      await expect(chain.autochargeAttested("a".repeat(64), 1800000000, "b".repeat(128))).rejects.toThrow("SLIPPAY_CONTRACT not set");
      await expect(chain.armGate("a".repeat(64), "c".repeat(64))).rejects.toThrow("SLIPPAY_CONTRACT not set");
    });

    it("whoami returns the exact public key derived from SLIPPAY_SIGNER_SECRET", () => {
      expect(chain.whoami()).toBe(TEST_PUBLIC);
    });
  });

  describe("ScVal and Address Helpers", () => {
    it("scAddr encodes G-address (account) and C-address (contract) into Address ScVal", () => {
      const gSc = chain.scAddr(TEST_MERCHANT);
      expect(gSc.switch()).toEqual(xdr.ScValType.scvAddress());

      const cSc = chain.scAddr(TEST_CONTRACT);
      expect(cSc.switch()).toEqual(xdr.ScValType.scvAddress());
    });

    it("scAddr throws on invalid address format", () => {
      expect(() => chain.scAddr("not-a-valid-address")).toThrow();
    });

    it("scI128, scU64, scU32, and scBytes encode correct primitive types", () => {
      const i128Val = chain.scI128(10000000n);
      expect(i128Val.switch()).toEqual(xdr.ScValType.scvI128());

      const u64Val = chain.scU64(86400);
      expect(u64Val.switch()).toEqual(xdr.ScValType.scvU64());

      const u32Val = chain.scU32(10);
      expect(u32Val.switch()).toEqual(xdr.ScValType.scvU32());

      const bytesVal = chain.scBytes("aabbcc");
      expect(bytesVal.switch()).toEqual(xdr.ScValType.scvBytes());
    });

    it("randomNonceHex generates a 64-char (32 bytes) hex string", () => {
      const nonce1 = chain.randomNonceHex();
      const nonce2 = chain.randomNonceHex();
      expect(nonce1).toHaveLength(64);
      expect(nonce2).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(nonce1)).toBe(true);
      expect(nonce1).not.toBe(nonce2);
    });

    it("usdcSacId returns a deterministic Soroban contract ID for USDC", () => {
      const sacId = chain.usdcSacId();
      expect(sacId).toMatch(/^C[A-Z0-9]{55}$/);
    });

    it("explorerTx constructs valid stellar.expert URLs", () => {
      const hash = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      const url = chain.explorerTx(hash);
      expect(url).toContain("stellar.expert/explorer/");
      expect(url).toContain(hash);
    });
  });

  describe("Amount and Parameter Boundary Checks", () => {
    it("pay rejects non-positive or non-numeric amounts", async () => {
      await expect(chain.pay(TEST_MERCHANT, "0")).rejects.toThrow("Invalid amount");
      await expect(chain.pay(TEST_MERCHANT, "-1.5")).rejects.toThrow("Invalid amount");
      await expect(chain.pay(TEST_MERCHANT, "abc")).rejects.toThrow("Invalid amount");
      await expect(chain.pay(TEST_MERCHANT, "")).rejects.toThrow("Invalid amount");
    });

    it("subscribe rejects invalid amounts, period < 86400, or negative bounds", async () => {
      await expect(chain.subscribe(TEST_MERCHANT, "0", 86400)).rejects.toThrow("Invalid amount");
      await expect(chain.subscribe(TEST_MERCHANT, "-10", 86400)).rejects.toThrow("Invalid amount");
      await expect(chain.subscribe(TEST_MERCHANT, "NaN", 86400)).rejects.toThrow("Invalid amount");

      // Period checks
      await expect(chain.subscribe(TEST_MERCHANT, "10", 86399)).rejects.toThrow("period_seconds");
      await expect(chain.subscribe(TEST_MERCHANT, "10", 0)).rejects.toThrow("period_seconds");
      await expect(chain.subscribe(TEST_MERCHANT, "10", 86400.5)).rejects.toThrow("period_seconds");

      // Bounds
      await expect(chain.subscribe(TEST_MERCHANT, "10", 86400, -1)).rejects.toThrow("max_periods");
      await expect(chain.subscribe(TEST_MERCHANT, "10", 86400, 0, -1)).rejects.toThrow("expires_at");
    });

    it("approve rejects non-positive amounts or invalid expiration ledger", async () => {
      await expect(chain.approve("0", 500000)).rejects.toThrow("Invalid amount");
      await expect(chain.approve("-50", 500000)).rejects.toThrow("Invalid amount");
      await expect(chain.approve("10", 0)).rejects.toThrow("expiration_ledger");
      await expect(chain.approve("10", -100)).rejects.toThrow("expiration_ledger");
      await expect(chain.approve("10", 500000.5)).rejects.toThrow("expiration_ledger");
    });

    it("autocharge rejects non-hex or invalid length subscription_id", async () => {
      await expect(chain.autocharge("")).rejects.toThrow("subscription_id");
      await expect(chain.autocharge("short")).rejects.toThrow("subscription_id");
      await expect(chain.autocharge("zz".repeat(32))).rejects.toThrow("subscription_id");
    });

    it("autochargeAttested validates subscription_id, not_after, and signatureHex format", async () => {
      const validSubId = "a".repeat(64);
      const validSig = "b".repeat(128);

      await expect(chain.autochargeAttested("bad", 1700000000, validSig)).rejects.toThrow("subscription_id");
      await expect(chain.autochargeAttested(validSubId, 0, validSig)).rejects.toThrow("not_after");
      await expect(chain.autochargeAttested(validSubId, -1, validSig)).rejects.toThrow("not_after");
      await expect(chain.autochargeAttested(validSubId, 1700000000.5, validSig)).rejects.toThrow("not_after");
      await expect(chain.autochargeAttested(validSubId, 1700000000, "short")).rejects.toThrow("signature");
      await expect(chain.autochargeAttested(validSubId, 1700000000, "zz".repeat(64))).rejects.toThrow("signature");
    });

    it("armGate validates subscription_id and attesterPubkeyHex format", async () => {
      const validSubId = "a".repeat(64);
      const validPubkey = "c".repeat(64);

      await expect(chain.armGate("bad", validPubkey)).rejects.toThrow("subscription_id");
      await expect(chain.armGate(validSubId, "short")).rejects.toThrow("attester_pubkey");
      await expect(chain.armGate(validSubId, "zz".repeat(32))).rejects.toThrow("attester_pubkey");
    });

    it("txStatus validates transaction hash format", async () => {
      await expect(chain.txStatus("")).rejects.toThrow("transaction hash");
      await expect(chain.txStatus("not-64-hex")).rejects.toThrow("transaction hash");
    });
  });

  describe("Mocked RPC Transaction Building, Encoding and Submission", () => {
    function createMockRpc() {
      const recordedCalls: { contractId: string; fn: string; args: xdr.ScVal[] }[] = [];

      const emptyData = new xdr.SorobanTransactionData({
        ext: new xdr.ExtensionPoint(0),
        resources: new xdr.SorobanResources({
          footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
          instructions: 100,
          readBytes: 100,
          writeBytes: 100,
        }),
        resourceFee: xdr.Int64.fromString("100"),
      });

      const mockRpc: chain.RpcClient = {
        getAccount: vi.fn().mockImplementation(async (pubkey: string) => new Account(pubkey, "100")),
        simulateTransaction: vi.fn().mockImplementation(async (tx) => {
          // Inspect operation on tx
          const op = tx.operations[0] as any;
          if (op && op.func) {
            const invokeArgs = typeof op.func.invokeContract === "function" ? op.func.invokeContract() : op.func;
            const contractId = Address.fromScAddress(invokeArgs.contractAddress()).toString();
            const fn = invokeArgs.functionName().toString();
            const args = invokeArgs.args();
            recordedCalls.push({ contractId, fn, args });
          }
          return {
            id: "1",
            minResourceFee: "100",
            transactionData: emptyData.toXDR("base64"),
            results: [{ auth: [], xdr: xdr.ScVal.scvVoid().toXDR("base64") }],
          } as any;
        }),
        sendTransaction: vi.fn().mockResolvedValue({
          status: "PENDING",
          hash: "deadbeef".repeat(8),
        } as any),
        getTransaction: vi.fn().mockResolvedValue({
          status: "SUCCESS",
        } as any),
      };

      return { mockRpc, recordedCalls };
    }

    it("pay encodes SAC transfer with caller, recipient, and stroops", async () => {
      const { mockRpc, recordedCalls } = createMockRpc();
      chain.setRpcClient(mockRpc);

      const res = await chain.pay(TEST_MERCHANT, "12.50");

      expect(res.hash).toBe("deadbeef".repeat(8));
      expect(res.status).toBe("SUCCESS");
      expect(mockRpc.getAccount).toHaveBeenCalledWith(TEST_PUBLIC);
      expect(recordedCalls).toHaveLength(1);

      const call = recordedCalls[0];
      expect(call.contractId).toBe(chain.usdcSacId());
      expect(call.fn).toBe("transfer");
      expect(call.args).toHaveLength(3);

      // Arg 0: from (caller)
      const fromAddr = Address.fromScVal(call.args[0]).toString();
      expect(fromAddr).toBe(TEST_PUBLIC);

      // Arg 1: to (recipient)
      const toAddr = Address.fromScVal(call.args[1]).toString();
      expect(toAddr).toBe(TEST_MERCHANT);

      // Arg 2: amount (12.50 USDC = 125,000,000 stroops)
      const amountVal = call.args[2];
      expect(amountVal.switch()).toEqual(xdr.ScValType.scvI128());
      const rawI128 = amountVal.i128();
      const hi = BigInt(rawI128.hi().toString());
      const lo = BigInt(rawI128.lo().toString());
      const stroops = (hi << 64n) + lo;
      expect(stroops).toBe(125000000n);
    });

    it("subscribe encodes create invocation with caller, merchant, sacId, stroops, period, and nonce", async () => {
      const { mockRpc, recordedCalls } = createMockRpc();
      chain.setRpcClient(mockRpc);

      const res = await chain.subscribe(TEST_MERCHANT, "9.00", 86400, 12, 1750000000);

      expect(res.hash).toBe("deadbeef".repeat(8));
      expect(res.subscription_id).toHaveLength(64);
      expect(recordedCalls).toHaveLength(1);

      const call = recordedCalls[0];
      expect(call.contractId).toBe(TEST_CONTRACT);
      expect(call.fn).toBe("create");
      expect(call.args).toHaveLength(8);

      // from
      expect(Address.fromScVal(call.args[0]).toString()).toBe(TEST_PUBLIC);
      // merchant
      expect(Address.fromScVal(call.args[1]).toString()).toBe(TEST_MERCHANT);
      // sacId
      expect(Address.fromScVal(call.args[2]).toString()).toBe(chain.usdcSacId());
      // period_seconds (86400)
      expect(call.args[4].switch()).toEqual(xdr.ScValType.scvU64());
      // max_periods (12)
      expect(call.args[5].switch()).toEqual(xdr.ScValType.scvU32());
      // expires_at (1750000000)
      expect(call.args[6].switch()).toEqual(xdr.ScValType.scvU64());
      // nonce bytes
      expect(call.args[7].bytes().toString("hex")).toBe(res.subscription_id);
    });

    it("approve encodes SAC approve with caller, subscription contract, stroops, and expiration ledger", async () => {
      const { mockRpc, recordedCalls } = createMockRpc();
      chain.setRpcClient(mockRpc);

      const res = await chain.approve("108.00", 654321);

      expect(res.status).toBe("SUCCESS");
      expect(recordedCalls).toHaveLength(1);

      const call = recordedCalls[0];
      expect(call.contractId).toBe(chain.usdcSacId());
      expect(call.fn).toBe("approve");
      expect(call.args).toHaveLength(4);

      // caller
      expect(Address.fromScVal(call.args[0]).toString()).toBe(TEST_PUBLIC);
      // spender (subContract)
      expect(Address.fromScVal(call.args[1]).toString()).toBe(TEST_CONTRACT);
      // expiration ledger
      expect(call.args[3].u32()).toBe(654321);
    });

    it("autocharge encodes contract call with subscription_id bytes", async () => {
      const { mockRpc, recordedCalls } = createMockRpc();
      chain.setRpcClient(mockRpc);

      const subId = "11".repeat(32);
      await chain.autocharge(subId);

      expect(recordedCalls).toHaveLength(1);
      const call = recordedCalls[0];
      expect(call.contractId).toBe(TEST_CONTRACT);
      expect(call.fn).toBe("autocharge");
      expect(call.args[0].bytes().toString("hex")).toBe(subId);
    });

    it("autochargeAttested encodes contract call with subscription_id, not_after, and signature bytes", async () => {
      const { mockRpc, recordedCalls } = createMockRpc();
      chain.setRpcClient(mockRpc);

      const subId = "22".repeat(32);
      const sig = "33".repeat(64);
      const notAfter = 1720000000;
      await chain.autochargeAttested(subId, notAfter, sig);

      expect(recordedCalls).toHaveLength(1);
      const call = recordedCalls[0];
      expect(call.contractId).toBe(TEST_CONTRACT);
      expect(call.fn).toBe("autocharge_attested");
      expect(call.args).toHaveLength(3);
      expect(call.args[0].bytes().toString("hex")).toBe(subId);
      expect(call.args[1].switch()).toEqual(xdr.ScValType.scvU64());
      expect(call.args[2].bytes().toString("hex")).toBe(sig);
    });

    it("armGate encodes set_attester call with subscription_id and attester_pubkey bytes", async () => {
      const { mockRpc, recordedCalls } = createMockRpc();
      chain.setRpcClient(mockRpc);

      const subId = "44".repeat(32);
      const attester = "55".repeat(32);
      await chain.armGate(subId, attester);

      expect(recordedCalls).toHaveLength(1);
      const call = recordedCalls[0];
      expect(call.contractId).toBe(TEST_CONTRACT);
      expect(call.fn).toBe("set_attester");
      expect(call.args).toHaveLength(2);
      expect(call.args[0].bytes().toString("hex")).toBe(subId);
      expect(call.args[1].bytes().toString("hex")).toBe(attester);
    });

    it("handles RPC simulation failure fail-closed", async () => {
      const { mockRpc } = createMockRpc();
      mockRpc.simulateTransaction = vi.fn().mockResolvedValue({
        id: "1",
        error: "HostError: Contract error 404",
      } as any);
      chain.setRpcClient(mockRpc);

      await expect(chain.pay(TEST_MERCHANT, "1.00")).rejects.toThrow("simulation failed (transfer)");
    });

    it("handles RPC sendTransaction error fail-closed", async () => {
      const { mockRpc } = createMockRpc();
      mockRpc.sendTransaction = vi.fn().mockResolvedValue({
        status: "ERROR",
        errorResult: { tx_bad_seq: true },
      } as any);
      chain.setRpcClient(mockRpc);

      await expect(chain.pay(TEST_MERCHANT, "1.00")).rejects.toThrow("send error (transfer)");
    });
  });

  describe("Horizon txStatus Lookup", () => {
    it("returns settlement status when transaction is found on Horizon", async () => {
      const hash = "12".repeat(32);
      const mockHorizon: chain.HorizonClient = {
        transactions: vi.fn().mockReturnValue({
          transaction: vi.fn().mockReturnValue({
            call: vi.fn().mockResolvedValue({
              successful: true,
              ledger_attr: 987654,
              created_at: "2026-10-19T10:00:00Z",
            }),
          }),
        }),
      };
      chain.setHorizonClient(mockHorizon);

      const res = (await chain.txStatus(hash)) as any;
      expect(res.found).toBe(true);
      expect(res.successful).toBe(true);
      expect(res.ledger).toBe(987654);
      expect(res.explorer).toContain(hash);
    });

    it("returns found=false with error detail when Horizon transaction call fails", async () => {
      const hash = "34".repeat(32);
      const mockHorizon: chain.HorizonClient = {
        transactions: vi.fn().mockReturnValue({
          transaction: vi.fn().mockReturnValue({
            call: vi.fn().mockRejectedValue(new Error("Request failed with status code 404")),
          }),
        }),
      };
      chain.setHorizonClient(mockHorizon);

      const res = (await chain.txStatus(hash)) as any;
      expect(res.found).toBe(false);
      expect(res.detail).toContain("404");
      expect(res.explorer).toContain(hash);
    });
  });
});
