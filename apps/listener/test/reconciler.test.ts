import { describe, it, expect, vi, beforeEach } from "vitest";
import { reconcileMatch } from "../src/reconciler.js";

function makeMockDb() {
  const single = vi.fn();
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const insert = vi.fn().mockReturnThis();
  const update = vi.fn().mockReturnThis();
  const eq = vi.fn().mockReturnThis();
  const inFn = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnThis();
  const from = vi.fn().mockReturnThis();
  const mock = { from, update, insert, eq, in: inFn, select, single, maybeSingle };
  return mock as unknown as Parameters<typeof reconcileMatch>[0] & typeof mock;
}

describe("reconcileMatch", () => {
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => { mockDb = makeMockDb(); });

  it("updates pending order to paid and enqueues webhook on outcome=paid", async () => {
    mockDb.single.mockResolvedValueOnce({ data: { id: "ord-1", external_ref: "x", brl_amount: "10.00", usdc_amount: "1.7", paid_at: "2026-05-07T00:00:00Z" }, error: null });
    await reconcileMatch(mockDb, { id: "ord-1", merchant_id: "m-1", memo: "ab".repeat(32), usdc_amount: "1.7", merchant_stellar_address: "G".padEnd(56,"A"), platform_fee_bp: 100 }, { outcome: "paid" }, "txhash");
    expect(mockDb.update).toHaveBeenCalledWith(expect.objectContaining({ status: "paid", tx_hash: "txhash" }));
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("is idempotent on already-paid order (no webhook insert when no row matched)", async () => {
    mockDb.single.mockResolvedValueOnce({ data: null, error: null });
    await reconcileMatch(mockDb, { id: "ord-1", merchant_id: "m-1", memo: "ab".repeat(32), usdc_amount: "1.7", merchant_stellar_address: "G".padEnd(56,"A"), platform_fee_bp: 100 }, { outcome: "paid" }, "txhash");
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("does nothing on ignore outcome", async () => {
    await reconcileMatch(mockDb, { id: "ord-1", merchant_id: "m-1", memo: "ab".repeat(32), usdc_amount: "1.7", merchant_stellar_address: "G".padEnd(56,"A"), platform_fee_bp: 100 }, { outcome: "ignore" }, "txhash");
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("allows underpaid→paid transition (audit-003 L3)", async () => {
    mockDb.single.mockResolvedValueOnce({ data: { id: "ord-1", external_ref: "x", brl_amount: "10.00", usdc_amount: "1.7", paid_at: "2026-05-16T00:00:00Z" }, error: null });
    await reconcileMatch(mockDb, { id: "ord-1", merchant_id: "m-1", memo: "ab".repeat(32), usdc_amount: "1.7", merchant_stellar_address: "G".padEnd(56,"A"), platform_fee_bp: 100 }, { outcome: "paid" }, "topup-tx");
    expect(mockDb.in).toHaveBeenCalledWith("status", ["pending", "underpaid"]);
  });

  it("only allows pending→underpaid (no backward transition)", async () => {
    mockDb.single.mockResolvedValueOnce({ data: null, error: null });
    await reconcileMatch(mockDb, { id: "ord-1", merchant_id: "m-1", memo: "ab".repeat(32), usdc_amount: "1.7", merchant_stellar_address: "G".padEnd(56,"A"), platform_fee_bp: 100 }, { outcome: "underpaid", expected: "1.7000000", received: "0.5000000" }, "partial-tx");
    expect(mockDb.in).toHaveBeenCalledWith("status", ["pending"]);
  });

  it("dedupe on unique-violation (23505) does not log error", async () => {
    mockDb.single.mockResolvedValueOnce({ data: { id: "ord-1", external_ref: "x", brl_amount: "10.00", usdc_amount: "1.7", paid_at: "2026-05-16T00:00:00Z" }, error: null });
    mockDb.insert.mockReturnValueOnce(Promise.resolve({ error: { code: "23505", message: "duplicate" } }));
    await reconcileMatch(mockDb, { id: "ord-1", merchant_id: "m-1", memo: "ab".repeat(32), usdc_amount: "1.7", merchant_stellar_address: "G".padEnd(56,"A"), platform_fee_bp: 100 }, { outcome: "paid" }, "txhash");
    // no throw, no error log assertion — surviving the call is the contract
    expect(mockDb.insert).toHaveBeenCalled();
  });

  describe("bumpSubscriptionChargesDone (Issue #489)", () => {
    it("two concurrent paid events advance charges_done by 2 under OCC conditional write", async () => {
      // In-memory subscription table simulating concurrent access and latency
      const subStore = {
        id: "sub-concurrent-1",
        charges_done: 0,
        max_periods: 5,
        status: "active",
      };

      const createSimulatedDb = () => {
        return {
          from: (table: string) => {
            if (table !== "subscriptions") throw new Error(`Unexpected table ${table}`);
            let condition: { col: string; val: any } | null = null;
            let patchData: any = null;

            return {
              select: (_cols: string) => ({
                eq: (_col: string, _val: string) => ({
                  maybeSingle: async () => {
                    // Small delay to ensure concurrent tasks interleave reads
                    await new Promise((r) => setTimeout(r, 10));
                    return { data: { ...subStore }, error: null };
                  },
                }),
              }),
              update: (patch: any) => {
                patchData = patch;
                const chain: any = {
                  eq: (col: string, val: any) => {
                    condition = { col, val };
                    return chain;
                  },
                  is: (col: string, val: any) => {
                    condition = { col, val };
                    return chain;
                  },
                  select: () => ({
                    maybeSingle: async () => {
                      // Validate conditional write (OCC)
                      if (condition?.col === "charges_done") {
                        if (subStore.charges_done !== condition.val) {
                          // Conflict: charges_done changed, return 0 rows
                          return { data: null, error: null };
                        }
                      }
                      // Apply update
                      Object.assign(subStore, patchData);
                      return { data: { ...subStore }, error: null };
                    },
                  }),
                };
                return chain;
              },
            };
          },
        } as any;
      };

      const db1 = createSimulatedDb();
      const db2 = createSimulatedDb();

      // Launch two concurrent reconciliations
      const [res1, res2] = await Promise.all([
        import("../src/reconciler.js").then((m) => m.bumpSubscriptionChargesDone(db1, "sub-concurrent-1")),
        import("../src/reconciler.js").then((m) => m.bumpSubscriptionChargesDone(db2, "sub-concurrent-1")),
      ]);

      expect(res1).not.toBeNull();
      expect(res2).not.toBeNull();
      // Counter must advance by two
      expect(subStore.charges_done).toBe(2);
      expect(subStore.status).toBe("active");
    });

    it("expires subscription when charges_done reaches max_periods exactly", async () => {
      const subStore = {
        id: "sub-max-test",
        charges_done: 2,
        max_periods: 3,
        status: "active",
      };

      const mockDbInstance: any = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { ...subStore }, error: null }),
            }),
          }),
          update: (patch: any) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => {
                    Object.assign(subStore, patch);
                    return { data: { ...subStore }, error: null };
                  },
                }),
              }),
            }),
          }),
        }),
      };

      const { bumpSubscriptionChargesDone } = await import("../src/reconciler.js");
      const result = await bumpSubscriptionChargesDone(mockDbInstance, "sub-max-test");

      expect(result).not.toBeNull();
      expect(result?.charges_done).toBe(3);
      expect(result?.status).toBe("expired");
      expect(subStore.charges_done).toBe(3);
      expect(subStore.status).toBe("expired");
    });

    it("prefers atomic RPC if available on the database", async () => {
      const rpcMock = vi.fn().mockResolvedValue({
        data: [{ charges_done: 4, status: "expired" }],
        error: null,
      });
      const dbWithRpc: any = {
        rpc: rpcMock,
      };

      const { bumpSubscriptionChargesDone } = await import("../src/reconciler.js");
      const result = await bumpSubscriptionChargesDone(dbWithRpc, "sub-rpc-1");

      expect(rpcMock).toHaveBeenCalledWith("bump_subscription_charges_done", { sub_id: "sub-rpc-1" });
      expect(result).toEqual({ charges_done: 4, status: "expired" });
    });
  });
});
