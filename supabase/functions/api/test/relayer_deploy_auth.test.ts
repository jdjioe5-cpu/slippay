import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  issueDeployToken,
  verifyAndConsumeDeployToken,
  checkAndReserveDailyFloat,
  getDailyFloatBudget,
  getDailyFloatSpend,
  recordFundedWallet,
  getFundedWalletsLog,
  _resetDeployTokensForTest,
  _resetDailyFloatBudgetForTest,
} from "../routes/relayer.ts";
import relayerApp from "../routes/relayer.ts";

const VALID_PUBKEY_HEX_1 = "04" + "aa".repeat(64);
const VALID_PUBKEY_HEX_2 = "04" + "bb".repeat(64);
const VALID_CRED_HEX = "cc".repeat(32);

Deno.test("relayer deploy auth: issueDeployToken generates unique single-use challenge tokens", () => {
  _resetDeployTokensForTest();
  const token1 = issueDeployToken();
  const token2 = issueDeployToken();
  assert(token1.length === 64, "token must be 64-char hex");
  assert(token2.length === 64, "token must be 64-char hex");
  assert(token1 !== token2, "tokens must be unique");

  // First consumption succeeds
  const v1 = verifyAndConsumeDeployToken(token1, VALID_PUBKEY_HEX_1);
  assertEquals(v1, { ok: true });

  // Second consumption with same token is rejected (prevent replay)
  const v2 = verifyAndConsumeDeployToken(token1, VALID_PUBKEY_HEX_1);
  assertEquals(v2, { ok: false, reason: "deploy_token_already_used" });
});

Deno.test("relayer deploy auth: verifyAndConsumeDeployToken enforces passkey pubkey binding", () => {
  _resetDeployTokensForTest();
  // Token issued bound to pubkey 1
  const token = issueDeployToken(VALID_PUBKEY_HEX_1);

  // Attempting to consume with pubkey 2 must fail
  const wrongPubVerdict = verifyAndConsumeDeployToken(token, VALID_PUBKEY_HEX_2);
  assertEquals(wrongPubVerdict, {
    ok: false,
    reason: "deploy_token_bound_to_different_pubkey",
  });

  // Consuming with correct pubkey succeeds
  const rightPubVerdict = verifyAndConsumeDeployToken(token, VALID_PUBKEY_HEX_1);
  assertEquals(rightPubVerdict, { ok: true });
});

Deno.test("relayer deploy auth: unauthenticated POST /deploy returns 401 without deploying or funding", async () => {
  _resetDeployTokensForTest();

  // Missing deploy_token entirely
  const reqNoToken = new Request("http://localhost/deploy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      passkey_pubkey_hex: VALID_PUBKEY_HEX_1,
      cred_id_hex: VALID_CRED_HEX,
    }),
  });
  const resNoToken = await relayerApp.fetch(reqNoToken);
  assertEquals(resNoToken.status, 401);
  const jsonNoToken = await resNoToken.json();
  assertEquals(jsonNoToken.error, "unauthenticated");
  assertEquals(jsonNoToken.reason, "missing_deploy_token");

  // Invalid fake deploy_token
  const reqBadToken = new Request("http://localhost/deploy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      passkey_pubkey_hex: VALID_PUBKEY_HEX_1,
      cred_id_hex: VALID_CRED_HEX,
      deploy_token: "0000000000000000000000000000000000000000000000000000000000000000",
    }),
  });
  const resBadToken = await relayerApp.fetch(reqBadToken);
  assertEquals(resBadToken.status, 401);
  const jsonBadToken = await resBadToken.json();
  assertEquals(jsonBadToken.error, "unauthenticated");
  assertEquals(jsonBadToken.reason, "invalid_or_expired_deploy_token");
});

Deno.test("relayer deploy auth: replayed deploy token on POST /deploy is rejected with 401", async () => {
  _resetDeployTokensForTest();
  const token = issueDeployToken();

  // First consumption manually marks it used
  const v1 = verifyAndConsumeDeployToken(token, VALID_PUBKEY_HEX_1);
  assertEquals(v1, { ok: true });

  // Attempting to use the already consumed token in /deploy request
  const reqReplay = new Request("http://localhost/deploy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      passkey_pubkey_hex: VALID_PUBKEY_HEX_1,
      cred_id_hex: VALID_CRED_HEX,
      deploy_token: token,
    }),
  });
  const resReplay = await relayerApp.fetch(reqReplay);
  assertEquals(resReplay.status, 401);
  const jsonReplay = await resReplay.json();
  assertEquals(jsonReplay.error, "unauthenticated");
  assertEquals(jsonReplay.reason, "deploy_token_already_used");
});

Deno.test("relayer budget: daily float ceiling prevents exhaustion and returns 429", async () => {
  _resetDailyFloatBudgetForTest();
  _resetDeployTokensForTest();

  // Configure a small test budget: 4,000,000 stroops (0.4 XLM), each deploy funds 2,000,000 stroops (0.2 XLM)
  Deno.env.set("RELAYER_DAILY_FLOAT_BUDGET", "4000000");
  const budget = getDailyFloatBudget();
  assertEquals(budget, 4000000n);

  const fundAmt = 2000000n;

  // First funding reservation passes
  const check1 = checkAndReserveDailyFloat(fundAmt);
  assertEquals(check1.ok, true);
  recordFundedWallet({
    wallet_id: "CDEMOWALLET1111111111111111111111111111111111111111111111",
    amount: fundAmt.toString(),
    timestamp: new Date().toISOString(),
    admin: "GDEMOSPONSOR111111111111111111111111111111111111111111111",
  });
  assertEquals(getDailyFloatSpend(), 2000000n);

  // Second funding reservation passes (reaches exactly 4,000,000 stroops)
  const check2 = checkAndReserveDailyFloat(fundAmt);
  assertEquals(check2.ok, true);
  recordFundedWallet({
    wallet_id: "CDEMOWALLET2222222222222222222222222222222222222222222222",
    amount: fundAmt.toString(),
    timestamp: new Date().toISOString(),
    admin: "GDEMOSPONSOR111111111111111111111111111111111111111111111",
  });
  assertEquals(getDailyFloatSpend(), 4000000n);

  // Third funding reservation fails with daily_float_budget_exhausted
  const check3 = checkAndReserveDailyFloat(fundAmt);
  assertEquals(check3.ok, false);
  assertEquals(check3.reason, "daily_float_budget_exhausted");

  // Attempting /deploy when budget is exhausted returns 429
  const token = issueDeployToken();
  const reqExhausted = new Request("http://localhost/deploy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      passkey_pubkey_hex: VALID_PUBKEY_HEX_1,
      cred_id_hex: VALID_CRED_HEX,
      deploy_token: token,
    }),
  });
  const resExhausted = await relayerApp.fetch(reqExhausted);
  assertEquals(resExhausted.status, 429);
  const jsonExhausted = await resExhausted.json();
  assertEquals(jsonExhausted.error, "rate_limited");
  assertEquals(jsonExhausted.reason, "daily_float_budget_exhausted");
  assertEquals(jsonExhausted.budget, "4000000");
  assertEquals(jsonExhausted.spent, "4000000");
});

Deno.test("relayer reconciliation: funded wallets ledger records all deployments", async () => {
  _resetDailyFloatBudgetForTest();

  recordFundedWallet({
    wallet_id: "CAAAA111122223333444455556666777788889999AAAABBBBCCCCDDD",
    amount: "2000000",
    timestamp: "2026-10-19T06:00:00.000Z",
    admin: "GSPONSOR1111111111111111111111111111111111111111111111111",
  });

  const log = getFundedWalletsLog();
  assertEquals(log.length, 1);
  assertEquals(log[0].wallet_id, "CAAAA111122223333444455556666777788889999AAAABBBBCCCCDDD");
  assertEquals(log[0].amount, "2000000");

  // GET /funded exposes the reconcilable ledger
  const reqFunded = new Request("http://localhost/funded", { method: "GET" });
  const resFunded = await relayerApp.fetch(reqFunded);
  assertEquals(resFunded.status, 200);
  const jsonFunded = await resFunded.json();
  assertEquals(jsonFunded.wallets.length, 1);
  assertEquals(jsonFunded.wallets[0].wallet_id, log[0].wallet_id);
  assertEquals(jsonFunded.daily_spent, "2000000");
});
