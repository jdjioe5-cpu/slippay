import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Buffer } from "node:buffer";
import {
  getAllowedTransferContracts,
  validateSponsorable,
} from "../routes/relayer.ts";
import {
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  StrKey,
  xdr,
} from "npm:@stellar/stellar-sdk@13";
import { NETWORK } from "@slippay/shared";

// Fixed test keypairs and addresses
const SPONSOR_KP = Keypair.random();
const SPONSOR_PUBKEY = SPONSOR_KP.publicKey();

// Valid StrKey checksummed contract addresses
const CONTRACT_A_ID = StrKey.encodeContract(Buffer.from(new Uint8Array(32).fill(0x11)));
const CONTRACT_B_ID = StrKey.encodeContract(Buffer.from(new Uint8Array(32).fill(0x22)));
const EVIL_CONTRACT_ID = StrKey.encodeContract(Buffer.from(new Uint8Array(32).fill(0x66)));

// Precalculated SAC IDs for testnet
const TESTNET_NATIVE_SAC = Asset.native().contractId(Networks.TESTNET);
const TESTNET_USDC_SAC = new Asset("USDC", NETWORK.testnet.usdc_issuer).contractId(Networks.TESTNET);

// Precalculated SAC IDs for mainnet
const MAINNET_NATIVE_SAC = Asset.native().contractId(Networks.PUBLIC);
const MAINNET_USDC_SAC = new Asset("USDC", NETWORK.mainnet.usdc_issuer).contractId(Networks.PUBLIC);

function buildTransferTxXdr(options: {
  contractId: string;
  from?: xdr.ScVal;
  to?: xdr.ScVal;
  amount?: xdr.ScVal;
  functionName?: string;
  args?: xdr.ScVal[];
  sponsorPubkey?: string;
  fee?: string;
  networkPassphrase?: string;
}): string {
  const fromVal = options.from ?? new Address(CONTRACT_A_ID).toScVal();
  const toVal = options.to ?? new Address(Keypair.random().publicKey()).toScVal();
  const amountVal = options.amount ?? nativeToScVal(100_000n, { type: "i128" });
  const fnName = options.functionName ?? "transfer";
  const callArgs = options.args ?? [fromVal, toVal, amountVal];

  const transferOp = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(options.contractId).toScAddress(),
        functionName: fnName,
        args: callArgs,
      }),
    ),
    auth: [],
  });

  const sponsor = options.sponsorPubkey ?? SPONSOR_PUBKEY;
  const dummyAccount = {
    accountId: () => sponsor,
    sequenceNumber: () => "100",
    incrementSequenceNumber: () => {},
  };

  const tx = new TransactionBuilder(dummyAccount as any, {
    fee: options.fee ?? "100",
    networkPassphrase: options.networkPassphrase ?? Networks.TESTNET,
  }).addOperation(transferOp).setTimeout(60).build();

  return tx.toXDR();
}

Deno.test("relayer: getAllowedTransferContracts contains native SAC and USDC SAC", () => {
  const testnetSet = getAllowedTransferContracts(Networks.TESTNET);
  assert(testnetSet.has(TESTNET_NATIVE_SAC), "testnet allowed set must have native SAC");
  assert(testnetSet.has(TESTNET_USDC_SAC), "testnet allowed set must have USDC SAC");

  const mainnetSet = getAllowedTransferContracts(Networks.PUBLIC);
  assert(mainnetSet.has(MAINNET_NATIVE_SAC), "mainnet allowed set must have native SAC");
  assert(mainnetSet.has(MAINNET_USDC_SAC), "mainnet allowed set must have USDC SAC");
});

Deno.test("relayer: validateSponsorable permits transfer on native SAC within cap", () => {
  const txXdr = buildTransferTxXdr({
    contractId: TESTNET_NATIVE_SAC,
  });
  const res = validateSponsorable(txXdr, SPONSOR_PUBKEY);
  assertEquals(res, { ok: true });
});

Deno.test("relayer: validateSponsorable permits transfer on allowlisted USDC SAC within cap", () => {
  const txXdr = buildTransferTxXdr({
    contractId: TESTNET_USDC_SAC,
  });
  const res = validateSponsorable(txXdr, SPONSOR_PUBKEY);
  assertEquals(res, { ok: true });
});

Deno.test("relayer: validateSponsorable rejects transfer on un-allowlisted arbitrary contract naming the contract", () => {
  const txXdr = buildTransferTxXdr({
    contractId: EVIL_CONTRACT_ID,
  });
  const res = validateSponsorable(txXdr, SPONSOR_PUBKEY);
  assertEquals(res.ok, false);
  assertEquals(res.reason, `disallowed_contract: ${EVIL_CONTRACT_ID}`);
});

Deno.test("relayer: validateSponsorable rejects destination args[1] that is not an address", () => {
  // Pass an integer ScVal instead of an address
  const badToVal = nativeToScVal(12345n, { type: "i128" });
  const txXdr = buildTransferTxXdr({
    contractId: TESTNET_NATIVE_SAC,
    to: badToVal,
  });
  const res = validateSponsorable(txXdr, SPONSOR_PUBKEY);
  assertEquals(res, { ok: false, reason: "to_not_address" });
});

Deno.test("relayer: validateSponsorable permits contract destination address", () => {
  // Destination is another contract address (contract-to-contract transfer)
  const contractToVal = new Address(CONTRACT_B_ID).toScVal();
  const txXdr = buildTransferTxXdr({
    contractId: TESTNET_NATIVE_SAC,
    to: contractToVal,
  });
  const res = validateSponsorable(txXdr, SPONSOR_PUBKEY);
  assertEquals(res, { ok: true });
});

Deno.test("relayer: validateSponsorable rejects source args[0] that is not a contract address", () => {
  // Classic account as `from`
  const classicFromVal = new Address(Keypair.random().publicKey()).toScVal();
  const txXdr = buildTransferTxXdr({
    contractId: TESTNET_NATIVE_SAC,
    from: classicFromVal,
  });
  const res = validateSponsorable(txXdr, SPONSOR_PUBKEY);
  assertEquals(res, { ok: false, reason: "from_not_contract" });
});

Deno.test("relayer: validateSponsorable rejects non-transfer function calls", () => {
  const txXdr = buildTransferTxXdr({
    contractId: TESTNET_NATIVE_SAC,
    functionName: "approve",
  });
  const res = validateSponsorable(txXdr, SPONSOR_PUBKEY);
  assertEquals(res, { ok: false, reason: "not_transfer" });
});

Deno.test("relayer: validateSponsorable rejects incorrect transfer arguments count", () => {
  const txXdr = buildTransferTxXdr({
    contractId: TESTNET_NATIVE_SAC,
    args: [new Address(CONTRACT_A_ID).toScVal()],
  });
  const res = validateSponsorable(txXdr, SPONSOR_PUBKEY);
  assertEquals(res, { ok: false, reason: "bad_transfer_args" });
});

Deno.test("relayer: validateSponsorable rejects transfer amounts over cap or non-positive", () => {
  // 1. Amount exceeding default cap (5 XLM = 50,000,000 stroops)
  const overCapTxXdr = buildTransferTxXdr({
    contractId: TESTNET_NATIVE_SAC,
    amount: nativeToScVal(50_000_001n, { type: "i128" }),
  });
  assertEquals(validateSponsorable(overCapTxXdr, SPONSOR_PUBKEY), {
    ok: false,
    reason: "amount_over_cap",
  });

  // 2. Zero amount
  const zeroTxXdr = buildTransferTxXdr({
    contractId: TESTNET_NATIVE_SAC,
    amount: nativeToScVal(0n, { type: "i128" }),
  });
  assertEquals(validateSponsorable(zeroTxXdr, SPONSOR_PUBKEY), {
    ok: false,
    reason: "amount_not_positive",
  });
});
