import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveDefaultContract,
  isValidContractId,
  resolveSubscriptionContract,
  MAINNET_DEFAULT_CONTRACT,
} from "./autocharge-scheduler.mjs";

test("resolveDefaultContract returns null on testnet without explicit env overrides", () => {
  const contract = resolveDefaultContract("testnet", "");
  assert.equal(contract, null);
});

test("resolveDefaultContract returns CONTRACT when explicitly provided on testnet", () => {
  const explicit = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const contract = resolveDefaultContract("testnet", explicit);
  assert.equal(contract, explicit);
});

test("resolveDefaultContract returns mainnet default when network is mainnet or public", () => {
  assert.equal(resolveDefaultContract("mainnet", ""), MAINNET_DEFAULT_CONTRACT);
  assert.equal(resolveDefaultContract("public", ""), MAINNET_DEFAULT_CONTRACT);
});

test("isValidContractId validates 56-character C... StrKey format", () => {
  // Valid 56-character contract id starting with C
  assert.equal(isValidContractId("CD2RFNOLMIKZN4EETDCGULGMD4ANS56IIUDIBLOE24P4JRZM2GCVFV2U"), true);
  assert.equal(isValidContractId("CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN"), true);

  // Invalid: starts with G (account, not contract)
  assert.equal(isValidContractId("GBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN"), false);

  // Invalid: too short or truncated
  assert.equal(isValidContractId("CD2RFNOLMIKZN4EET"), false);

  // Invalid characters (0, 1, 8, 9 are not in RFC 4648 base32)
  assert.equal(isValidContractId("CD2RFNOLMIKZN4EETDCGULGMD4ANS56IIUDIBLOE24P4JRZM2GCVFV21"), false);

  // Invalid: null, undefined, non-string
  assert.equal(isValidContractId(null), false);
  assert.equal(isValidContractId(undefined), false);
});

test("resolveSubscriptionContract uses row contract id when present and valid", () => {
  const row = { id: "sub_1", soroban_contract_id: "CD2RFNOLMIKZN4EETDCGULGMD4ANS56IIUDIBLOE24P4JRZM2GCVFV2U" };
  const res = resolveSubscriptionContract(row, "testnet", null);
  assert.equal(res.ok, true);
  assert.equal(res.contractId, "CD2RFNOLMIKZN4EETDCGULGMD4ANS56IIUDIBLOE24P4JRZM2GCVFV2U");
});

test("resolveSubscriptionContract rejects invalid contract id on row with clear error", () => {
  const row = { id: "sub_bad", soroban_contract_id: "invalid_contract_string" };
  const res = resolveSubscriptionContract(row, "testnet", null);
  assert.equal(res.ok, false);
  assert.equal(res.error, "invalid_contract_id");
  assert.match(res.reason, /not a valid 56-character C\.\.\. StrKey/);
});

test("resolveSubscriptionContract fails fast on testnet when contract is absent", () => {
  const row = { id: "sub_missing", soroban_contract_id: null };
  const res = resolveSubscriptionContract(row, "testnet", null);
  assert.equal(res.ok, false);
  assert.equal(res.error, "missing_contract");
  assert.match(res.reason, /no contract configured for network testnet/);
});

test("resolveSubscriptionContract falls back to mainnet default on mainnet", () => {
  const row = { id: "sub_main", soroban_contract_id: null };
  const res = resolveSubscriptionContract(row, "mainnet", MAINNET_DEFAULT_CONTRACT);
  assert.equal(res.ok, true);
  assert.equal(res.contractId, MAINNET_DEFAULT_CONTRACT);
});
