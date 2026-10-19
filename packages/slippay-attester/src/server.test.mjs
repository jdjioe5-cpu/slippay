// Unit and integration tests for attester server startup secret validation
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveAttesterSecret, createAttesterServer } from "./server.mjs";
import { publicKeyHex } from "./oracle.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "server.mjs");

console.log("=== Attester Server Secret Guard Tests ===");

// 1. Unset secret without opt-in throws
assert.throws(
  () => resolveAttesterSecret({}),
  /SLIPPAY_ATTESTER_SECRET is not set/
);
console.log("  ✓ Unset secret without opt-in throws fail-fast error");

// 2. Production refuses dev key even if opt-in flag is provided
assert.throws(
  () => resolveAttesterSecret({ NODE_ENV: "production" }),
  /NODE_ENV=production/
);
assert.throws(
  () => resolveAttesterSecret({ NODE_ENV: "production", SLIPPAY_ATTESTER_ALLOW_DEV_KEY: "1" }),
  /NODE_ENV=production/
);
console.log("  ✓ Production refuses dev key unconditionally (even with opt-in)");

// 3. Malformed hex secret throws
assert.throws(
  () => resolveAttesterSecret({ SLIPPAY_ATTESTER_SECRET: "not-a-valid-hex" }),
  /failed to parse hex string|odd hex length/
);
console.log("  ✓ Malformed hex secret throws named error");

// 4. Invalid length secret throws (e.g. 16 bytes / 32 hex chars)
assert.throws(
  () => resolveAttesterSecret({ SLIPPAY_ATTESTER_SECRET: "0123456789abcdef0123456789abcdef" }),
  /decoded length is 16 bytes, expected 32 bytes/
);
console.log("  ✓ Under-length secret (16 bytes) throws length mismatch error");

// 5. Valid 32-byte secret loads successfully
const testSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const loaded = resolveAttesterSecret({ SLIPPAY_ATTESTER_SECRET: testSecret });
assert.equal(loaded.kind, "env");
assert.equal(loaded.priv.length, 32);
console.log("  ✓ Valid 32-byte secret loads cleanly into Uint8Array");

// 6. Explicit opt-in permits dev key in non-production
const devLoaded = resolveAttesterSecret({ SLIPPAY_ATTESTER_ALLOW_DEV_KEY: "1" });
assert.equal(devLoaded.kind, "DEV-seed");
assert.equal(devLoaded.priv.length, 32);
console.log("  ✓ Explicit dev opt-in permits dev seed with warning in non-production");

// 7. Process lifecycle: Running server.mjs as standalone process exits non-zero without secret
const resNoSecret = spawnSync(process.execPath, [serverPath], {
  env: { ...process.env, SLIPPAY_ATTESTER_SECRET: "", SLIPPAY_ATTESTER_ALLOW_DEV_KEY: "" },
  encoding: "utf-8",
});
assert.equal(resNoSecret.status, 1);
assert.match(resNoSecret.stderr, /SLIPPAY_ATTESTER_SECRET is not set/);
console.log("  ✓ Subprocess exits non-zero (1) when started without secret");

// 8. Process lifecycle: Production mode exits non-zero even with opt-in
const resProd = spawnSync(process.execPath, [serverPath], {
  env: { ...process.env, NODE_ENV: "production", SLIPPAY_ATTESTER_ALLOW_DEV_KEY: "1", SLIPPAY_ATTESTER_SECRET: "" },
  encoding: "utf-8",
});
assert.equal(resProd.status, 1);
assert.match(resProd.stderr, /NODE_ENV=production/);
console.log("  ✓ Subprocess exits non-zero (1) under NODE_ENV=production");

// 9. Server instance test with resolved key
const server = createAttesterServer(loaded.priv);
await new Promise((resolve) => {
  server.listen(0, async () => {
    const port = server.address().port;
    const resp = await fetch(`http://127.0.0.1:${port}/pubkey`);
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.pubkey, await publicKeyHex(loaded.priv));
    server.close(resolve);
  });
});
console.log("  ✓ Server starts with resolved key and serves /pubkey matching private key");

console.log("\n=== All server guard tests passed! ===");
