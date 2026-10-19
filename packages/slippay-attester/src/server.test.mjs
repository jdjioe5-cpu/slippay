// Unit and integration tests for attester server:
// 1. Secret validation & fail-fast startup guard (Issue #465)
// 2. Authentication, principal-binding authorization, and CORS restriction (Issue #466)
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveAttesterSecret, createAttesterServer } from "./server.mjs";
import { publicKeyHex } from "./oracle.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "server.mjs");

console.log("=== Attester Server Guard & Authentication Tests ===");

// ---- Part 1: Secret Startup Guard Tests ----
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
  () => resolveAttesterSecret({ SLIPPAY_ATTESTER_SECRET: "not-a-valid-hex" }),
  /failed to parse hex string|odd hex length/
);
assert.throws(
  () => resolveAttesterSecret({ SLIPPAY_ATTESTER_SECRET: "0123456789abcdef0123456789abcdef" }),
  /decoded length is 16 bytes, expected 32 bytes/
);
const testSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const loaded = resolveAttesterSecret({ SLIPPAY_ATTESTER_SECRET: testSecret });
assert.equal(loaded.kind, "env");
assert.equal(loaded.priv.length, 32);

const devLoaded = resolveAttesterSecret({ SLIPPAY_ATTESTER_ALLOW_DEV_KEY: "1" });
assert.equal(devLoaded.kind, "DEV-seed");
console.log("  ✓ Secret guardrails & production fail-fast verified");

// ---- Part 2: Authentication, Principal Binding & CORS Tests ----
const testEnv = {
  SLIPPAY_ATTESTER_SECRET: testSecret,
  SLIPPAY_ATTESTER_API_KEYS: JSON.stringify({
    "token-alice": "principal-alice",
    "token-bob": "principal-bob",
  }),
  SLIPPAY_ATTESTER_ALLOWED_ORIGINS: "https://app.slippay.cc,https://api.slippay.cc",
};

const server = createAttesterServer(loaded.priv, testEnv);

await new Promise((resolve, reject) => {
  server.listen(0, async () => {
    try {
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}`;

      // A. Public endpoints
      const pubkeyRes = await fetch(`${base}/pubkey`);
      assert.equal(pubkeyRes.status, 200);
      const pubkeyData = await pubkeyRes.json();
      assert.equal(pubkeyData.pubkey, await publicKeyHex(loaded.priv));
      console.log("  ✓ Public GET /pubkey serves key without authentication");

      // B. Unauthenticated /register is rejected (401)
      const unauthReg = await fetch(`${base}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "agent-1", allowed_recipients: ["GXYZ"] }),
      });
      assert.equal(unauthReg.status, 401);
      console.log("  ✓ Unauthenticated POST /register rejected with 401");

      // C. Unauthenticated /attest is rejected (401)
      const unauthAtt = await fetch(`${base}/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "agent-1", recipient: "GXYZ", amount: "100" }),
      });
      assert.equal(unauthAtt.status, 401);
      console.log("  ✓ Unauthenticated POST /attest rejected with 401");

      // D. Principal Alice registers agent-1
      const aliceReg = await fetch(`${base}/register`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token-alice",
        },
        body: JSON.stringify({
          agent_id: "agent-1",
          allowed_recipients: ["GALICE1234567890"],
          max_amount: "5000000",
        }),
      });
      assert.equal(aliceReg.status, 200);
      const aliceRegData = await aliceReg.json();
      assert.equal(aliceRegData.owner, "principal-alice");
      assert(aliceRegData.commitment);
      console.log("  ✓ Principal Alice successfully registers agent-1 with ownership binding");

      // E. Principal Bob attempts to hijack/re-register agent-1 -> REJECTED (403)
      const bobHijack = await fetch(`${base}/register`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token-bob",
        },
        body: JSON.stringify({
          agent_id: "agent-1",
          allowed_recipients: ["GBOB1234567890"],
          max_amount: "9999999999",
        }),
      });
      assert.equal(bobHijack.status, 403);
      const bobHijackData = await bobHijack.json();
      assert.match(bobHijackData.error, /owned by principal "principal-alice"/);
      console.log("  ✓ Principal Bob cannot hijack or re-register Alice's agent (403 Forbidden)");

      // F. Principal Bob attempts to request attestation for agent-1 -> REJECTED (403)
      const bobAttest = await fetch(`${base}/attest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "token-bob",
        },
        body: JSON.stringify({
          agent_id: "agent-1",
          recipient: "GALICE1234567890",
          amount: "1000",
        }),
      });
      assert.equal(bobAttest.status, 403);
      const bobAttestData = await bobAttest.json();
      assert.match(bobAttestData.error, /owned by principal "principal-alice"/);
      console.log("  ✓ Principal Bob cannot request attestation for Alice's agent (403 Forbidden)");

      // G. Principal Alice requests attestation for her own agent-1 -> GRANTED (200)
      const aliceAttest = await fetch(`${base}/attest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token-alice",
        },
        body: JSON.stringify({
          agent_id: "agent-1",
          recipient: "GALICE1234567890",
          amount: "1000",
          subscription_id: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          charges_done: 0,
        }),
      });
      assert.equal(aliceAttest.status, 200);
      const aliceAttestData = await aliceAttest.json();
      assert.equal(aliceAttestData.ok, true);
      assert(aliceAttestData.signature);
      console.log("  ✓ Principal Alice successfully gets signed attestation for agent-1");

      // H. CORS restriction checks
      // 1. Unauthorized origin: no Access-Control-Allow-Origin returned
      const corsAttacker = await fetch(`${base}/pubkey`, {
        headers: { origin: "https://evil.com" },
      });
      assert.equal(corsAttacker.headers.get("access-control-allow-origin"), null);

      // 2. Allowed origin: returns matching Access-Control-Allow-Origin
      const corsAllowed = await fetch(`${base}/pubkey`, {
        headers: { origin: "https://app.slippay.cc" },
      });
      assert.equal(corsAllowed.headers.get("access-control-allow-origin"), "https://app.slippay.cc");

      // 3. Preflight OPTIONS request
      const corsOptions = await fetch(`${base}/register`, {
        method: "OPTIONS",
        headers: { origin: "https://app.slippay.cc" },
      });
      assert.equal(corsOptions.status, 204);
      assert.equal(corsOptions.headers.get("access-control-allow-origin"), "https://app.slippay.cc");
      console.log("  ✓ CORS headers strictly bound to configured origins; wildcard '*' eliminated");

      server.close(resolve);
    } catch (e) {
      server.close();
      reject(e);
    }
  });
});

console.log("\n=== All attester auth, principal-binding and CORS tests passed! ===");
