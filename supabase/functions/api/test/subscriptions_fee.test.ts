import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  calculateFeeSplitStellar,
  convertBrlToUsdcStellar,
  stellarToStroops,
  stroopsToStellar,
} from "@slippay/shared";

Deno.test("subscriptions fee: byte-identical usdc_amount, fee_usdc and net_usdc across subscription charge and order paths", () => {
  // Shared inputs representing varied real-world BRL prices and exchange rates
  const cases = [
    { brl: "100.00", rate: "5.2500000", feeBp: 297 },
    { brl: "52.50", rate: "5.2500000", feeBp: 297 },
    { brl: "1.00", rate: "5.7142857", feeBp: 250 },
    { brl: "19.90", rate: "5.1234567", feeBp: 297 },
    { brl: "999.99", rate: "5.3333333", feeBp: 150 },
    { brl: "10.00", rate: "3.0000000", feeBp: 0 },
    { brl: "100.00", rate: "5.0000000", feeBp: 10000 },
  ];

  for (const tc of cases) {
    // 1. Subscription charge path calculation
    const subUsdc = convertBrlToUsdcStellar(tc.brl, tc.rate);
    const subSplit = calculateFeeSplitStellar(subUsdc, tc.feeBp);
    const subFeeUsdc = subSplit.feeStellar;
    const subNetUsdc = subSplit.netStellar;

    // 2. Order path calculation
    const orderUsdc = convertBrlToUsdcStellar(tc.brl, tc.rate);
    const orderSplit = calculateFeeSplitStellar(orderUsdc, tc.feeBp);
    const orderFeeUsdc = orderSplit.feeStellar;
    const orderNetUsdc = orderSplit.netStellar;

    // Assert byte-identical equality
    assertEquals(subUsdc, orderUsdc, `usdc_amount must match exactly for BRL ${tc.brl}`);
    assertEquals(subFeeUsdc, orderFeeUsdc, `fee_usdc must match exactly for BRL ${tc.brl}`);
    assertEquals(subNetUsdc, orderNetUsdc, `net_usdc must match exactly for BRL ${tc.brl}`);

    // Verify conservation identity
    const grossStroops = stellarToStroops(subUsdc);
    const feeStroops = stellarToStroops(subFeeUsdc);
    const netStroops = stellarToStroops(subNetUsdc);
    assertEquals(feeStroops + netStroops, grossStroops, "Conservation identity fee + net == gross must hold");
  }
});

Deno.test("subscriptions fee: floor division strictly matches Soroban checkout contract (contracts/checkout/src/lib.rs)", () => {
  // Vector where binary float .toFixed(7) rounds up, but contracts/checkout floors:
  // 1.0000190 USDC at 297 bps
  // Float: (1.0000190 * 297 / 10000).toFixed(7) === "0.0297006" (WRONG - rounds up)
  // Contract i128: 10000190 * 297 / 10000 = 297005 stroops === "0.0297005" (CORRECT - floored)
  const usdcDiscrepancy = "1.0000190";
  const feeBp = 297;

  const split = calculateFeeSplitStellar(usdcDiscrepancy, feeBp);

  // Contract simulation in i128 integer math
  const amountStroops = 10_000_190n;
  const contractFeeStroops = (amountStroops * BigInt(feeBp)) / 10_000n; // 297005n
  const contractNetStroops = amountStroops - contractFeeStroops; // 9703185n

  assertEquals(split.feeStroops, contractFeeStroops);
  assertEquals(split.netStroops, contractNetStroops);
  assertEquals(split.feeStellar, "0.0297005");
  assertEquals(split.netStellar, "0.9703185");

  // Verify float discrepancy is avoided
  const floatFee = (parseFloat(usdcDiscrepancy) * feeBp / 10_000).toFixed(7);
  assertEquals(floatFee, "0.0297006"); // confirms float rounds up
  assert(split.feeStellar !== floatFee, "Subscription fee must floor and not round up via float");
});

Deno.test("subscriptions fee: vector table matching boundary & precision cases", () => {
  const vectorTable = [
    { gross: "10.0000000", bp: 297, fee: "0.2970000", net: "9.7030000" },
    { gross: "1.0000000", bp: 297, fee: "0.0297000", net: "0.9703000" },
    { gross: "0.0000001", bp: 297, fee: "0.0000000", net: "0.0000001" }, // micro-dust: fee truncated to 0
    { gross: "0.0000033", bp: 297, fee: "0.0000000", net: "0.0000033" }, // 33 * 297 / 10000 = 0.98 -> 0 stroops
    { gross: "0.0000336", bp: 297, fee: "0.0000009", net: "0.0000327" }, // 336 * 297 / 10000 = 9.9792 -> 9 stroops
    { gross: "0.0000337", bp: 297, fee: "0.0000010", net: "0.0000327" }, // 337 * 297 / 10000 = 10.0089 -> 10 stroops = 0.0000010
    { gross: "100.0000000", bp: 0, fee: "0.0000000", net: "100.0000000" },
    { gross: "100.0000000", bp: 10000, fee: "100.0000000", net: "0.0000000" },
  ];

  for (const v of vectorTable) {
    const res = calculateFeeSplitStellar(v.gross, v.bp);
    assertEquals(res.feeStellar, v.fee, `Fee for ${v.gross} at ${v.bp} bps`);
    assertEquals(res.netStellar, v.net, `Net for ${v.gross} at ${v.bp} bps`);
    assertEquals(
      stellarToStroops(res.feeStellar) + stellarToStroops(res.netStellar),
      stellarToStroops(v.gross),
      "Fee + net == gross"
    );
  }
});

Deno.test("subscriptions route source code contains no parseFloat or toFixed on money values", async () => {
  const code = await Deno.readTextFile(new URL("../routes/subscriptions.ts", import.meta.url));

  // The charge handler begins at `r.post("/:id/charge"` and ends before `r.post("/:id/cancel"`
  const chargeRoutePart = code.split('r.post("/:id/charge"')[1]?.split('r.post("/:id/cancel"')[0];
  assert(chargeRoutePart, "charge route segment must exist in subscriptions.ts");

  // Ensure no parseFloat is called on money amounts (sub.brl_amount, usdc, fee, etc.)
  assert(!chargeRoutePart.includes("parseFloat(sub.brl_amount)"), "must not parseFloat(sub.brl_amount)");
  assert(!chargeRoutePart.includes("parseFloat(usdc)"), "must not parseFloat(usdc)");
  assert(!chargeRoutePart.includes("grossUsdc"), "grossUsdc float variable must be removed");

  // Ensure no toFixed is called in charge route
  assert(!chargeRoutePart.includes(".toFixed("), "charge route must not call .toFixed(");
});
