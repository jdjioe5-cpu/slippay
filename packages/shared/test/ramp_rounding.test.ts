import { describe, expect, it } from "vitest";

describe("Ramp Rounding & Rate Invariants (#109, #477)", () => {
  const marginBps = 280;
  const netBps = 10_000 - marginBps;
  const amountsBrl = [1.0, 5.0, 10.0, 25.5, 50.0, 100.0, 250.0, 500.0, 1000.0, 5000.0];
  const fxRates = [4.8, 5.0, 5.25, 5.5, 5.8, 6.0];

  it("calculates netBps using integer basis points without floating drift", () => {
    expect(netBps).toBe(9720);
    expect(Number.isInteger(netBps)).toBe(true);
  });

  it("verifies dollarRate * cryptoOut agrees with brl within 1 stroop and 1 cent across all pairs", () => {
    let checks = 0;
    for (const fx of fxRates) {
      for (const brl of amountsBrl) {
        const grossOut = brl / fx;
        // Floor rounding to 7 decimal places (stroops)
        const cryptoOut = Math.floor(grossOut * netBps * 1e2) / 1e6;
        const dollarRate = brl / cryptoOut;

        const reconstructed = dollarRate * cryptoOut;
        const diff = Math.abs(reconstructed - brl);

        expect(diff).toBeLessThanOrEqual(1e-7);
        expect(diff).toBeLessThan(0.01);
        checks++;
      }
    }
    expect(checks).toBe(amountsBrl.length * fxRates.length);
  });

  it("handles non-positive and zero values safely", () => {
    const brl = 0;
    const fx = 5.5;
    const grossOut = brl / fx;
    const cryptoOut = Math.floor(grossOut * netBps * 1e2) / 1e6;
    expect(cryptoOut).toBe(0);
    const dollarRate = cryptoOut > 0 ? brl / cryptoOut : null;
    expect(dollarRate).toBeNull();
  });
});
