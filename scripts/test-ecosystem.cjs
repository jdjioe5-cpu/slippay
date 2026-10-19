// @ts-check
const assert = require("node:assert");
const path = require("node:path");

console.log("Testing ecosystem.config.cjs structure and environment mapping...");

const ecosystem = require("../ecosystem.config.cjs");

// 1. Structure validation
assert.ok(ecosystem, "ecosystem export must be defined");
assert.ok(Array.isArray(ecosystem.apps), "ecosystem.apps must be an array");
assert.ok(ecosystem.apps.length >= 2, "ecosystem.apps must contain at least 2 default services");

const appNames = ecosystem.apps.map((a) => a.name);
console.log("Loaded apps:", appNames);

// 2. Critical app definitions
assert.ok(appNames.includes("slippay-api"), "apps must include slippay-api");
assert.ok(appNames.includes("slippay-listener"), "apps must include slippay-listener");

const apiApp = ecosystem.apps.find((a) => a.name === "slippay-api");
const listenerApp = ecosystem.apps.find((a) => a.name === "slippay-listener");

// 3. API App env assertions
assert.ok(apiApp.env, "slippay-api must have an env object");
assert.strictEqual(
  apiApp.env.SLIPPAY_DB_SCHEMA,
  process.env.SLIPPAY_DB_SCHEMA || "public",
  "apiEnv.SLIPPAY_DB_SCHEMA must match env or default to 'public'"
);
assert.strictEqual(
  apiApp.env.STELLAR_NETWORK,
  process.env.STELLAR_NETWORK || "TESTNET",
  "apiEnv.STELLAR_NETWORK must match env or default to 'TESTNET'"
);
assert.ok("CHECKOUT_BASE_URL" in apiApp.env, "apiEnv must have CHECKOUT_BASE_URL");
assert.ok("PORT" in apiApp.env, "apiEnv must have PORT");

// 4. Listener App env assertions
assert.ok(listenerApp.env, "slippay-listener must have an env object");
assert.strictEqual(
  listenerApp.env.SLIPPAY_DB_SCHEMA,
  process.env.SLIPPAY_DB_SCHEMA || "public",
  "listenerEnv.SLIPPAY_DB_SCHEMA must match env or default to 'public'"
);
assert.strictEqual(
  listenerApp.env.STELLAR_NETWORK,
  process.env.STELLAR_NETWORK || "TESTNET",
  "listenerEnv.STELLAR_NETWORK must match env or default to 'TESTNET'"
);

console.log("All ecosystem.config.cjs assertions passed successfully!");
