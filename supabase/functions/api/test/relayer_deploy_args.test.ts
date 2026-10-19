import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Set environment variables BEFORE importing relayer.ts
const DUMMY_WASM_HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
Deno.env.set("RELAYER_WASM_HASH", DUMMY_WASM_HASH);

import {
  validateConstructorArgs,
  validateSponsorable,
} from "../routes/relayer.ts";
import {
  Address,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "npm:@stellar/stellar-sdk@13";

// Fixed test vectors
const SPONSOR_KP = Keypair.random();
const SPONSOR_PUBKEY = SPONSOR_KP.publicKey();
const ATTACKER_KP = Keypair.random();
const ATTACKER_PUBKEY = ATTACKER_KP.publicKey();

// Valid 65-byte uncompressed secp256r1 public key with 0x04 prefix
const VALID_PASSKEY_PUB = new Uint8Array(65);
VALID_PASSKEY_PUB[0] = 0x04;
VALID_PASSKEY_PUB.fill(0xaa, 1);

// Valid 32-byte SHA-256 hash
const VALID_CRED_ID = new Uint8Array(32).fill(0xbb);

const VALID_MAX_ABS = 1_000_000_000n; // 100 XLM within default ceiling
const OVER_MAX_ABS = 100_000_000_000n; // exceeds default 1,000,000,000 ceiling

function makeValidCtorArgs(): xdr.ScVal[] {
  return [
    xdr.ScVal.scvBytes(VALID_PASSKEY_PUB),
    xdr.ScVal.scvBytes(VALID_CRED_ID),
    new Address(SPONSOR_PUBKEY).toScVal(),
    nativeToScVal(VALID_MAX_ABS, { type: "i128" }),
  ];
}

Deno.test("relayer: validateConstructorArgs unit test suite", () => {
  // 1. Valid constructor arguments pass
  const validArgs = makeValidCtorArgs();
  const resValid = validateConstructorArgs(validArgs, SPONSOR_PUBKEY);
  assertEquals(resValid, { ok: true });

  // 2. Reject bad passkey public key (wrong length)
  const badLenArgs = makeValidCtorArgs();
  badLenArgs[0] = xdr.ScVal.scvBytes(new Uint8Array(64));
  assertEquals(validateConstructorArgs(badLenArgs, SPONSOR_PUBKEY), {
    ok: false,
    reason: "bad_passkey_pubkey",
  });

  // 3. Reject bad passkey public key (wrong prefix, not 0x04)
  const badPrefixArgs = makeValidCtorArgs();
  const badPrefixBytes = new Uint8Array(VALID_PASSKEY_PUB);
  badPrefixBytes[0] = 0x02; // compressed
  badPrefixArgs[0] = xdr.ScVal.scvBytes(badPrefixBytes);
  assertEquals(validateConstructorArgs(badPrefixArgs, SPONSOR_PUBKEY), {
    ok: false,
    reason: "bad_passkey_pubkey",
  });

  // 4. Reject bad credential id (not 32 bytes)
  const badCredArgs = makeValidCtorArgs();
  badCredArgs[1] = xdr.ScVal.scvBytes(new Uint8Array(16));
  assertEquals(validateConstructorArgs(badCredArgs, SPONSOR_PUBKEY), {
    ok: false,
    reason: "bad_cred_id",
  });

  // 5. Reject admin not matching sponsor
  const badAdminArgs = makeValidCtorArgs();
  badAdminArgs[2] = new Address(ATTACKER_PUBKEY).toScVal();
  assertEquals(validateConstructorArgs(badAdminArgs, SPONSOR_PUBKEY), {
    ok: false,
    reason: "admin_not_sponsor",
  });

  // 6. Reject max_abs over ceiling
  const overAbsArgs = makeValidCtorArgs();
  overAbsArgs[3] = nativeToScVal(OVER_MAX_ABS, { type: "i128" });
  assertEquals(validateConstructorArgs(overAbsArgs, SPONSOR_PUBKEY), {
    ok: false,
    reason: "max_abs_over_cap",
  });

  // 7. Reject non-positive max_abs
  const zeroAbsArgs = makeValidCtorArgs();
  zeroAbsArgs[3] = nativeToScVal(0n, { type: "i128" });
  assertEquals(validateConstructorArgs(zeroAbsArgs, SPONSOR_PUBKEY), {
    ok: false,
    reason: "max_abs_not_positive",
  });

  // 8. Reject unexpected number of arguments
  assertEquals(validateConstructorArgs(validArgs.slice(0, 3), SPONSOR_PUBKEY), {
    ok: false,
    reason: "bad_ctor_args_count",
  });
});

function buildDeployTxXdr(ctorArgs: xdr.ScVal[]): string {
  const wasmBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    wasmBytes[i] = parseInt(DUMMY_WASM_HASH.slice(i * 2, i * 2 + 2), 16);
  }

  const deployOp = Operation.createCustomContract({
    address: new Address(SPONSOR_PUBKEY),
    wasmHash: wasmBytes,
    salt: new Uint8Array(32).fill(0x22),
    constructorArgs: ctorArgs,
  });

  const account = {
    accountId: () => SPONSOR_PUBKEY,
    sequenceNumber: () => "100",
    incrementSequenceNumber: () => {},
  };

  const tx = new TransactionBuilder(account as any, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  }).addOperation(deployOp).setTimeout(60).build();

  return tx.toXDR();
}

Deno.test("relayer: validateSponsorable rejects malicious createContractV2 operations", () => {
  // A. Legitimate deploy passes
  const validXdr = buildDeployTxXdr(makeValidCtorArgs());
  assertEquals(validateSponsorable(validXdr, SPONSOR_PUBKEY), { ok: true });

  // B. Malformed passkey argument is rejected
  const badPasskeyArgs = makeValidCtorArgs();
  badPasskeyArgs[0] = xdr.ScVal.scvBytes(new Uint8Array(32)); // wrong length
  const badPasskeyXdr = buildDeployTxXdr(badPasskeyArgs);
  const resBadPasskey = validateSponsorable(badPasskeyXdr, SPONSOR_PUBKEY);
  assertEquals(resBadPasskey, { ok: false, reason: "bad_passkey_pubkey" });

  // C. max_abs above the ceiling is rejected
  const overAbsArgs = makeValidCtorArgs();
  overAbsArgs[3] = nativeToScVal(OVER_MAX_ABS, { type: "i128" });
  const overAbsXdr = buildDeployTxXdr(overAbsArgs);
  const resOverAbs = validateSponsorable(overAbsXdr, SPONSOR_PUBKEY);
  assertEquals(resOverAbs, { ok: false, reason: "max_abs_over_cap" });

  // D. Attacker attempting to set self as admin is rejected
  const attackerAdminArgs = makeValidCtorArgs();
  attackerAdminArgs[2] = new Address(ATTACKER_PUBKEY).toScVal();
  const attackerAdminXdr = buildDeployTxXdr(attackerAdminArgs);
  const resAttacker = validateSponsorable(attackerAdminXdr, SPONSOR_PUBKEY);
  assertEquals(resAttacker, { ok: false, reason: "admin_not_sponsor" });
});

Deno.test("relayer: /deploy and /submit enforce identical constructor validation rules", () => {
  // Test matrix of malformed configurations
  const badCases = [
    {
      name: "truncated passkey pubkey",
      pubKey: new Uint8Array(64),
      credId: VALID_CRED_ID,
      admin: SPONSOR_PUBKEY,
      maxAbs: VALID_MAX_ABS,
      expectedReason: "bad_passkey_pubkey",
    },
    {
      name: "compressed 0x02 passkey pubkey",
      pubKey: (() => { const p = new Uint8Array(65); p[0] = 0x02; return p; })(),
      credId: VALID_CRED_ID,
      admin: SPONSOR_PUBKEY,
      maxAbs: VALID_MAX_ABS,
      expectedReason: "bad_passkey_pubkey",
    },
    {
      name: "short credential id",
      pubKey: VALID_PASSKEY_PUB,
      credId: new Uint8Array(20),
      admin: SPONSOR_PUBKEY,
      maxAbs: VALID_MAX_ABS,
      expectedReason: "bad_cred_id",
    },
    {
      name: "admin address spoofing",
      pubKey: VALID_PASSKEY_PUB,
      credId: VALID_CRED_ID,
      admin: ATTACKER_PUBKEY,
      maxAbs: VALID_MAX_ABS,
      expectedReason: "admin_not_sponsor",
    },
    {
      name: "max_abs ceiling breach",
      pubKey: VALID_PASSKEY_PUB,
      credId: VALID_CRED_ID,
      admin: SPONSOR_PUBKEY,
      maxAbs: OVER_MAX_ABS,
      expectedReason: "max_abs_over_cap",
    },
  ];

  for (const c of badCases) {
    const ctorArgs: xdr.ScVal[] = [
      xdr.ScVal.scvBytes(c.pubKey),
      xdr.ScVal.scvBytes(c.credId),
      new Address(c.admin).toScVal(),
      nativeToScVal(c.maxAbs, { type: "i128" }),
    ];

    // 1. Evaluate via shared validateConstructorArgs (used by /deploy)
    const deployVerdict = validateConstructorArgs(ctorArgs, SPONSOR_PUBKEY);
    assertEquals(deployVerdict.ok, false, `${c.name} in deploy verdict`);
    assertEquals(deployVerdict.reason, c.expectedReason, `${c.name} deploy reason`);

    // 2. Evaluate via validateSponsorable (used by /submit)
    const txXdr = buildDeployTxXdr(ctorArgs);
    const submitVerdict = validateSponsorable(txXdr, SPONSOR_PUBKEY);
    assertEquals(submitVerdict.ok, false, `${c.name} in submit verdict`);
    assertEquals(submitVerdict.reason, c.expectedReason, `${c.name} submit reason`);

    // 3. Assert parity: reasons must match exactly
    assertEquals(deployVerdict.reason, submitVerdict.reason, `${c.name} parity`);
  }
});
