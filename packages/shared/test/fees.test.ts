import { describe, it, expect } from "vitest";
import {
  stellarToStroops,
  stroopsToStellar,
  calculateFeeSplit,
  calculateFeeSplitStellar,
  convertBrlToUsdcStroops,
  convertBrlToUsdcStellar,
} from "../src/fees.ts";

describe("packages/shared/src/fees.ts canonical fee & stroop arithmetic", () => {
  describe("stellarToStroops & stroopsToStellar", () => {
    it("converts whole and decimal string amounts to stroops accurately", () => {
      expect(stellarToStroops("0")).toBe(0n);
      expect(stellarToStroops("0.0000001")).toBe(1n);
      expect(stellarToStroops("1")).toBe(10_000_000n);
      expect(stellarToStroops("1.5")).toBe(15_000_000n);
      expect(stellarToStroops("123.4567890")).toBe(1_234_567_890n);
      expect(stellarToStroops("99999999.9999999")).toBe(999_999_999_999_999n);
    });

    it("formats stroops back to canonical 7-decimal string", () => {
      expect(stroopsToStellar(0n)).toBe("0.0000000");
      expect(stroopsToStellar(1n)).toBe("0.0000001");
      expect(stroopsToStellar(10_000_000n)).toBe("1.0000000");
      expect(stroopsToStellar(15_000_000n)).toBe("1.5000000");
      expect(stroopsToStellar(1_234_567_890n)).toBe("123.4567890");
    });

    it("rejects invalid inputs", () => {
      expect(() => stellarToStroops("")).toThrow(/bad_amount/);
      expect(() => stellarToStroops("abc")).toThrow(/bad_amount/);
      expect(() => stellarToStroops("-1.0")).toThrow(/bad_amount/);
      expect(() => stellarToStroops("1.12345678")).toThrow(/bad_amount/); // 8 decimal places
      expect(() => stellarToStroops("1.2.3")).toThrow(/bad_amount/);
    });
  });

  describe("calculateFeeSplit & calculateFeeSplitStellar", () => {
    it("floors the fee to match contracts/checkout/src/lib.rs (amount * fee_bps / 10_000)", () => {
      // Vector where floating point round-up differs from integer floor:
      // 1.0000190 USDC = 10000190 stroops at 297 bps
      // Exact math: 10000190 * 297 / 10000 = 297005.643
      // Binary float (1.0000190 * 297 / 10000).toFixed(7) produces 0.0297006 (rounds UP)
      // Integer floor produces 297005 stroops = 0.0297005 USDC (floored)
      const splitFloatDiscrepancy = calculateFeeSplitStellar("1.0000190", 297);
      expect(splitFloatDiscrepancy.feeStellar).toBe("0.0297005");
      expect(splitFloatDiscrepancy.netStellar).toBe("0.9703185");
      expect(splitFloatDiscrepancy.feeStroops).toBe(297_005n);
      expect(splitFloatDiscrepancy.netStroops).toBe(9_703_185n);
      expect(splitFloatDiscrepancy.feeStroops + splitFloatDiscrepancy.netStroops).toBe(10_000_190n);

      // Another boundary case: 0.0000019 USDC at 297 bps
      // Float toFixed(7) rounds up to 0.0000001, but integer division produces 0 stroops!
      const splitMicro = calculateFeeSplitStellar("0.0000019", 297);
      expect(splitMicro.feeStellar).toBe("0.0000000");
      expect(splitMicro.netStellar).toBe("0.0000019");
      expect(splitMicro.feeStroops).toBe(0n);
      expect(splitMicro.netStroops).toBe(19n);
    });

    it("verifies canonical vector table with identity conservation", () => {
      const vectors = [
        { amount: 10_000_000n, bp: 297, expectedFee: 297_000n, expectedNet: 9_703_000n },
        { amount: 10_000_001n, bp: 25, expectedFee: 25_000n, expectedNet: 9_975_001n },
        { amount: 1n, bp: 297, expectedFee: 0n, expectedNet: 1n },
        { amount: 9_999n, bp: 297, expectedFee: 296n, expectedNet: 9_703n },
        { amount: 100_000_000_000n, bp: 1000, expectedFee: 10_000_000_000n, expectedNet: 90_000_000_000n },
        { amount: 50_000_000n, bp: 0, expectedFee: 0n, expectedNet: 50_000_000n },
        { amount: 50_000_000n, bp: 10_000, expectedFee: 50_000_000n, expectedNet: 0n },
      ];

      for (const tc of vectors) {
        const split = calculateFeeSplit(tc.amount, tc.bp);
        expect(split.feeStroops).toBe(tc.expectedFee);
        expect(split.netStroops).toBe(tc.expectedNet);
        expect(split.feeStroops + split.netStroops).toBe(tc.amount);
      }
    });

    it("rejects out of bounds and non-integer fee basis points", () => {
      expect(() => calculateFeeSplit(100n, -1)).toThrow(/Invalid fee basis points/);
      expect(() => calculateFeeSplit(100n, 10_001)).toThrow(/Invalid fee basis points/);
      expect(() => calculateFeeSplit(100n, 2.5)).toThrow(/Invalid fee basis points/);
      expect(() => calculateFeeSplit(-100n, 100)).toThrow(/Invalid amount stroops/);
    });
  });

  describe("convertBrlToUsdcStroops & convertBrlToUsdcStellar", () => {
    it("converts BRL to USDC with BigInt stroop division", () => {
      // 52.50 BRL at 5.25 rate = 10.0000000 USDC
      const usdc = convertBrlToUsdcStellar("52.50", 5.25);
      expect(usdc).toBe("10.0000000");

      // 100 BRL at 5.0 rate = 20.0000000 USDC
      const usdc2 = convertBrlToUsdcStellar("100.00", "5.0000000");
      expect(usdc2).toBe("20.0000000");

      // Truncation behavior without float drift
      // 100 BRL at 3.0 rate: 100 / 3 = 33.3333333333...
      // Stroops = 333333333n => 33.3333333
      const usdc3 = convertBrlToUsdcStellar("100", 3.0);
      expect(usdc3).toBe("33.3333333");
    });

    it("rejects non-positive rates", () => {
      expect(() => convertBrlToUsdcStellar("50", 0)).toThrow(/Invalid rate/);
      expect(() => convertBrlToUsdcStellar("50", -1)).toThrow(/bad_amount/);
    });
  });
});
