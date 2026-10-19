// Comprehensive HTTP service test suite for packages/slippay-attester/src/server.mjs
// Covers:
// - Ephemeral port server startup
// - Request routing table: /pubkey, /register, /attest, /verify, and 404 fallback
// - 403-vs-200 contract for refused attestations
// - Malformed JSON body handling (returns defined 400 error rather than silent {})
// - Startup guard from issue 153 (unset/production secret validation)

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveAttesterSecret, createAttesterServer } from "./server.mjs";
import { publicKeyHex } from "./oracle.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "server.mjs");

console.log("=== Attester Oracle HTTP Service Test Suite ===");

// 1. Startup guard (Issue 153)
assert.throws(
  () => resolveAttesterSecret({}),
  /SLIPPAY_ATTESTER_SECRET is not set/
);
assert.throws(
  () => resolveAttesterSecret({ NODE_ENV: "production" }),
  /NODE_ENV=production/
);
assert.throws(
  () => resolveAttesterSecret({ NODE_ENV: "production", SLIPPAY_ATTESTER_ALLOW_DEV_KEY: "1" }),
  /NODE_ENV=production/
);
assert.throws(
  () => resolveAttesterSecret({ SLIPPAY_ATTESTER_SECRET: "deadbeef" }),
  /decoded length is 4 bytes, expected 32 bytes/
);

// Process lifecycle: Running server.mjs directly without secret exits non-zero (1)
const procRun = spawnSync(process.execPath, [serverPath], {
  env: { ...process.env, SLIPPAY_ATTESTER_SECRET: "", SLIPPAY_ATTESTER_ALLOW_DEV_KEY: "" },
  encoding: "utf-8",
});
assert.equal(procRun.status, 1);
assert.match(procRun.stderr, /SLIPPAY_ATTESTER_SECRET is not set/);
console.log("  ✓ Startup guard (Issue 153): unset secret throws and subprocess exits non-zero (1)");

// 2. Start server on ephemeral port (port 0)
const testSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const { priv } = resolveAttesterSecret({ SLIPPAY_ATTESTER_SECRET: testSecret });
const server = createAttesterServer(priv);

await new Promise((resolve, reject) => {
  server.listen(0, async () => {
    try {
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}`;

      // Route 1: GET /pubkey
      const pubkeyRes = await fetch(`${base}/pubkey`);
      assert.equal(pubkeyRes.status, 200);
      const pubkeyData = await pubkeyRes.json();
      assert.equal(pubkeyData.pubkey, await publicKeyHex(priv));
      console.log("  ✓ GET /pubkey: returns attester ed25519 public key (200)");

      // Route 2: POST /register
      const testAgentId = `test-agent-${Date.now()}`;
      const regRes = await fetch(`${base}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: testAgentId,
          allowed_recipients: ["GAFK7XFZEVS66H6XGY66O4H66T2O6Z66666666666666666666666666"],
          allowed_tools: ["search", "calc"],
          max_amount: "1000000",
        }),
      });
      assert.equal(regRes.status, 200);
      const regData = await regRes.json();
      assert(typeof regData.commitment === "string" && regData.commitment.length === 64);
      console.log("  ✓ POST /register: commits surface and returns sha256 commitment (200)");

      // Route 3: POST /attest - Clean in-surface action -> 200 OK + signature
      const attestCleanRes = await fetch(`${base}/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: testAgentId,
          recipient: "GAFK7XFZEVS66H6XGY66O4H66T2O6Z66666666666666666666666666",
          amount: "500",
          tools_used: ["search"],
          subscription_id: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          charges_done: 0,
        }),
      });
      assert.equal(attestCleanRes.status, 200);
      const attestCleanData = await attestCleanRes.json();
      assert.equal(attestCleanData.ok, true);
      assert(typeof attestCleanData.signature === "string" && attestCleanData.signature.length === 128);
      console.log("  ✓ POST /attest (clean): returns signed attestation with 200 OK");

      // Route 3b: POST /attest - Refused deviation action -> 403 Forbidden (NOT 200!)
      const attestRefusedRes = await fetch(`${base}/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: testAgentId,
          recipient: "GEVILRECIPIENT00000000000000000000000000000000000000000000",
          amount: "500",
        }),
      });
      assert.equal(attestRefusedRes.status, 403, "Refused attestation MUST return 403, NOT 200");
      const attestRefusedData = await attestRefusedRes.json();
      assert.equal(attestRefusedData.ok, false);
      assert.match(attestRefusedData.reason, /outside the committed surface/);
      console.log("  ✓ POST /attest (refusal): deviation returns 403 Forbidden (not 200)");

      // Route 4: POST /verify
      const verifyRes = await fetch(`${base}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subscription_id: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          charges_done: 0,
          not_after: attestCleanData.not_after,
          signature: attestCleanData.signature,
          pubkey: pubkeyData.pubkey,
        }),
      });
      assert.equal(verifyRes.status, 200);
      const verifyData = await verifyRes.json();
      assert.equal(verifyData.valid, true);
      console.log("  ✓ POST /verify: verifies attestation signature (200, valid: true)");

      // Route 5: Malformed JSON body handling -> 400 Bad Request
      const malformedRes = await fetch(`${base}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{\"agent_id\": \"broken\", broken_json: true",
      });
      assert.equal(malformedRes.status, 400);
      const malformedData = await malformedRes.json();
      assert.match(malformedData.error, /malformed_json/);
      console.log("  ✓ Malformed JSON body: produces defined 400 malformed_json error (not silent {})");

      // Route 6: Unknown route -> 404 Not Found fallback
      const notFoundRes = await fetch(`${base}/non-existent-route`);
      assert.equal(notFoundRes.status, 404);
      const notFoundData = await notFoundRes.json();
      assert.equal(notFoundData.error, "not found");
      console.log("  ✓ Fallback: unknown route returns 404 Not Found");

      server.close(resolve);
    } catch (err) {
      server.close();
      reject(err);
    }
  });
});

console.log("\n=== All server tests passed successfully! ===");
