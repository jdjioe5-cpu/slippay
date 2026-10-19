import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  nativeToScVal,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from "npm:@stellar/stellar-sdk@13";
import { hexToBuf } from "@slippay/shared";

// Configure test environment before loading relayer route
const TEST_WASM_HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
Deno.env.set("RELAYER_WASM_HASH", TEST_WASM_HASH);

import {
  AMOUNT_CAP,
  FEE_CAP,
  PASSPHRASE,
  validateSponsorable,
} from "../routes/relayer.ts";

const SPONSOR_KP = Keypair.random();
const SPONSOR_PUB = SPONSOR_KP.publicKey();

// Valid Soroban contract and account addresses for testing
const CONTRACT_ADDR = Address.fromString(
  new Asset("USDC", Keypair.random().publicKey()).contractId(PASSPHRASE),
);
const RECIPIENT_ADDR = new Address(Keypair.random().publicKey());
const SAC_ADDR = Address.fromString(Asset.native().contractId(PASSPHRASE));

function buildTx(opts: {
  source?: string;
  fee?: string;
  operations: xdr.Operation[];
  passphrase?: string;
}): string {
  const account = {
    accountId: () => opts.source ?? SPONSOR_PUB,
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  };
  const builder = new TransactionBuilder(account as any, {
    fee: opts.fee ?? String(BASE_FEE),
    networkPassphrase: opts.passphrase ?? PASSPHRASE,
  });
  for (const op of opts.operations) {
    builder.addOperation(op as any);
  }
  builder.setTimeout(60);
  return builder.build().toXDR();
}

function makeTransferOp(opts?: {
  contractAddress?: Address;
  functionName?: string;
  from?: xdr.ScVal;
  to?: xdr.ScVal;
  amount?: xdr.ScVal;
  extraArgs?: xdr.ScVal[];
}): any {
  const fromVal = opts?.from ?? CONTRACT_ADDR.toScVal();
  const toVal = opts?.to ?? RECIPIENT_ADDR.toScVal();
  const amountVal = opts?.amount ?? nativeToScVal(1000000n, { type: "i128" });
  const fn = opts?.functionName ?? "transfer";
  const sac = opts?.contractAddress ?? SAC_ADDR;

  let args: xdr.ScVal[];
  if (opts?.extraArgs) {
    args = opts.extraArgs;
  } else {
    args = [fromVal, toVal, amountVal];
  }

  return Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: sac.toScAddress(),
        functionName: fn,
        args,
      }),
    ),
    auth: [],
  });
}

function makeDeployOp(wasmHashHex: string): any {
  return Operation.createCustomContract({
    address: new Address(SPONSOR_PUB),
    wasmHash: hexToBuf(wasmHashHex),
    salt: new Uint8Array(32),
    constructorArgs: [],
  });
}

// ── 1. bad_xdr ──
Deno.test("validateSponsorable rejects malformed XDR with bad_xdr", () => {
  const res = validateSponsorable("not-a-valid-xdr-string", SPONSOR_PUB);
  assertEquals(res.ok, false);
  assertMatch(res.reason ?? "", /^bad_xdr:/);
});

// ── 2. fee_bump_not_accepted ──
Deno.test("validateSponsorable rejects real FeeBumpTransaction envelope", () => {
  const innerXdr = buildTx({ operations: [makeTransferOp()] });
  const innerTx = TransactionBuilder.fromXDR(innerXdr, PASSPHRASE) as any;
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    SPONSOR_KP,
    "200",
    innerTx,
    PASSPHRASE,
  );
  const bumpXdr = feeBump.toXDR();

  const res = validateSponsorable(bumpXdr, SPONSOR_PUB);
  assertEquals(res.ok, false);
  assertEquals(res.reason, "fee_bump_not_accepted");
});

// ── 3. source_not_sponsor ──
Deno.test("validateSponsorable rejects transaction if source is not sponsor", () => {
  const otherKp = Keypair.random();
  const xdrStr = buildTx({
    source: otherKp.publicKey(),
    operations: [makeTransferOp()],
  });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, false);
  assertEquals(res.reason, "source_not_sponsor");
});

// ── 4. fee_over_cap & boundary ──
Deno.test("validateSponsorable rejects fee strictly greater than FEE_CAP", () => {
  const overFee = (FEE_CAP + 1n).toString();
  const xdrStr = buildTx({
    fee: overFee,
    operations: [makeTransferOp()],
  });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, false);
  assertEquals(res.reason, "fee_over_cap");
});

Deno.test("validateSponsorable accepts fee exactly at FEE_CAP", () => {
  const exactFee = FEE_CAP.toString();
  const xdrStr = buildTx({
    fee: exactFee,
    operations: [makeTransferOp()],
  });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, true);
});

// ── 5. must_be_single_op ──
Deno.test("validateSponsorable rejects transaction with multiple operations", () => {
  const xdrStr = buildTx({
    operations: [makeTransferOp(), makeTransferOp()],
  });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, false);
  assertEquals(res.reason, "must_be_single_op");
});

// ── 6. not_invoke_host_function ──
Deno.test("validateSponsorable rejects non-invokeHostFunction operations", () => {
  const paymentOp = Operation.payment({
    destination: RECIPIENT_ADDR.toString(),
    asset: Asset.native(),
    amount: "1",
  });
  const xdrStr = buildTx({ operations: [paymentOp as any] });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, false);
  assertEquals(res.reason, "not_invoke_host_function");
});

// ── 7. deploy_not_wasm ──
Deno.test("validateSponsorable rejects contract deploy when executable is not wasm", () => {
  const sacDeployOp = Operation.createStellarAssetContract({
    asset: Asset.native(),
  });
  const xdrStr = buildTx({ operations: [sacDeployOp as any] });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, false);
  assertEquals(res.reason, "deploy_not_wasm");
});

// ── 8. wrong_wasm_hash ──
Deno.test("validateSponsorable rejects contract deploy with mismatched wasm hash", () => {
  const wrongHash = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
  const op = makeDeployOp(wrongHash);
  const xdrStr = buildTx({ operations: [op] });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, false);
  assertEquals(res.reason, "wrong_wasm_hash");
});

// ── 9. Positive Deploy Path ──
Deno.test("validateSponsorable accepts valid wasm deploy matching configured hash", () => {
  const op = makeDeployOp(TEST_WASM_HASH);
  const xdrStr = buildTx({ operations: [op] });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, true);
  assertEquals(res.reason, undefined);
});

// ── 10. not_transfer ──
Deno.test("validateSponsorable rejects invokeContract calling non-transfer function", () => {
  const op = makeTransferOp({ functionName: "balance" });
  const xdrStr = buildTx({ operations: [op] });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, false);
  assertEquals(res.reason, "not_transfer");
});

// ── 11. bad_transfer_args ──
Deno.test("validateSponsorable rejects transfer with incorrect argument count", () => {
  // Only 2 args instead of 3
  const op = makeTransferOp({
    extraArgs: [CONTRACT_ADDR.toScVal(), RECIPIENT_ADDR.toScVal()],
  });
  const xdrStr = buildTx({ operations: [op] });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, false);
  assertEquals(res.reason, "bad_transfer_args");
});

// ── 12. from_not_contract ──
Deno.test("validateSponsorable rejects transfer if from address is an account rather than contract", () => {
  // Pass classic account address as `from`
  const accountFrom = new Address(SPONSOR_PUB).toScVal();
  const op = makeTransferOp({ from: accountFrom });
  const xdrStr = buildTx({ operations: [op] });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, false);
  assertEquals(res.reason, "from_not_contract");
});

// ── 13. amount_not_i128 ──
Deno.test("validateSponsorable rejects transfer if amount ScVal is not i128", () => {
  const badAmount = xdr.ScVal.scvU64(new xdr.Uint64(1000n));
  const op = makeTransferOp({ amount: badAmount });
  const xdrStr = buildTx({ operations: [op] });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, false);
  assertEquals(res.reason, "amount_not_i128");
});

// ── 14. amount_not_positive ──
Deno.test("validateSponsorable rejects transfer with zero or non-positive amount", () => {
  const zeroAmount = nativeToScVal(0n, { type: "i128" });
  const op = makeTransferOp({ amount: zeroAmount });
  const xdrStr = buildTx({ operations: [op] });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, false);
  assertEquals(res.reason, "amount_not_positive");
});

// ── 15. amount_over_cap & boundary ──
Deno.test("validateSponsorable rejects transfer strictly greater than AMOUNT_CAP", () => {
  const overAmount = nativeToScVal(AMOUNT_CAP + 1n, { type: "i128" });
  const op = makeTransferOp({ amount: overAmount });
  const xdrStr = buildTx({ operations: [op] });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, false);
  assertEquals(res.reason, "amount_over_cap");
});

Deno.test("validateSponsorable accepts transfer exactly at AMOUNT_CAP boundary", () => {
  const capAmount = nativeToScVal(AMOUNT_CAP, { type: "i128" });
  const op = makeTransferOp({ amount: capAmount });
  const xdrStr = buildTx({ operations: [op] });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, true);
});

// ── 16. Positive Transfer Path ──
Deno.test("validateSponsorable accepts valid contract SAC transfer within caps", () => {
  const op = makeTransferOp();
  const xdrStr = buildTx({ operations: [op] });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, true);
  assertEquals(res.reason, undefined);
});

// ── 17. unsupported_host_function ──
Deno.test("validateSponsorable rejects unsupported host function (e.g. uploadContractWasm)", () => {
  const uploadOp = Operation.uploadContractWasm({
    wasm: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
  });
  const xdrStr = buildTx({ operations: [uploadOp as any] });
  const res = validateSponsorable(xdrStr, SPONSOR_PUB);
  assertEquals(res.ok, false);
  assertMatch(res.reason ?? "", /^unsupported_host_function:/);
});
