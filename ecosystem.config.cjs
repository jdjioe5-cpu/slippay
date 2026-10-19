// PM2 ecosystem for slippay backend (api + listener) on the VPS.
// Reads /opt/slippay-backend/.env (server-only, never committed) and
// injects vars into both processes.
//
// Usage on server:
//   cd /opt/slippay-backend
//   pm2 start ecosystem.config.cjs
//   pm2 save

const path = require("node:path");
const fs = require("node:fs");

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

const ROOT = __dirname;
const env = loadEnv(path.join(ROOT, ".env"));

// Documented prefixes passed through from .env to the processes.
// Adding a new variable with one of these prefixes requires no edits here.
const FORWARD_PREFIXES = [
  "RELAYER_",
  "ETHERFUSE_",
  "FOURP_",
  "DUNE_",
  "ASK_",
  "CLAUDE_",
  "TRUSTED_",
  "SLIPPAY_",
  "STELLAR_",
  "SOROBAN_",
  "SUPABASE_",
  "CHECKOUT_",
  "API_KEY_",
  "RATE_",
  "ZOD_",
  "MERCHANT_",
  "LISTENER_",
  "PORT",
  "NODE_ENV",
  "HOME",
  "WEB_DIST",
  "SHOPIFY_",
];

function filterEnv(sourceEnv, prefixes = FORWARD_PREFIXES) {
  const out = {};
  if (!sourceEnv) return out;
  for (const [k, v] of Object.entries(sourceEnv)) {
    if (prefixes.some((p) => k.startsWith(p) || k === p)) {
      out[k] = v;
    }
  }
  return out;
}

function buildApiEnv(sourceEnv) {
  const filtered = filterEnv(sourceEnv);
  return {
    ...filtered,
    PORT: sourceEnv.API_PORT || sourceEnv.PORT || "8080",
    SLIPPAY_DB_SCHEMA: sourceEnv.SLIPPAY_DB_SCHEMA || "public",
    STELLAR_NETWORK: sourceEnv.STELLAR_NETWORK || "TESTNET",
    CHECKOUT_BASE_URL: sourceEnv.CHECKOUT_BASE_URL || "https://api.slippay.cc",
  };
}

function buildListenerEnv(sourceEnv) {
  const filtered = filterEnv(sourceEnv);
  return {
    NODE_ENV: "production",
    ...filtered,
    SLIPPAY_DB_SCHEMA: sourceEnv.SLIPPAY_DB_SCHEMA || "public",
    STELLAR_NETWORK: sourceEnv.STELLAR_NETWORK || "TESTNET",
    MERCHANT_POLL_MS: sourceEnv.MERCHANT_POLL_MS || "30000",
  };
}

const apiEnv = buildApiEnv(env);
const listenerEnv = buildListenerEnv(env);

const PULSE_PYTHON = path.join(ROOT, "agents/pulse/.venv/bin/python");
const PULSE_SCRIPT = path.join(ROOT, "agents/pulse/pulse.py");
const pulseAvailable = fs.existsSync(PULSE_PYTHON) && fs.existsSync(path.join(ROOT, "agents/pulse/.env"));

module.exports = {
  apps: [
    ...(pulseAvailable ? [{
      name: "slippay-pulse",
      cwd: path.join(ROOT, "agents/pulse"),
      script: PULSE_SCRIPT,
      interpreter: PULSE_PYTHON,
      restart_delay: 5000,
      max_memory_restart: "200M",
      out_file: path.join(ROOT, "logs/pulse.out.log"),
      error_file: path.join(ROOT, "logs/pulse.err.log"),
      time: true,
    }] : []),
    {
      name: "slippay-api",
      cwd: path.join(ROOT, "supabase/functions/api"),
      script: process.env.HOME + "/.deno/bin/deno",
      args: "run --allow-all --unstable index.ts",
      env: apiEnv,
      max_memory_restart: "400M",
      out_file: path.join(ROOT, "logs/api.out.log"),
      error_file: path.join(ROOT, "logs/api.err.log"),
      time: true,
    },
    {
      name: "slippay-listener",
      cwd: path.join(ROOT, "apps/listener"),
      script: "node",
      args: "dist/main.js",
      env: listenerEnv,
      max_memory_restart: "300M",
      out_file: path.join(ROOT, "logs/listener.out.log"),
      error_file: path.join(ROOT, "logs/listener.err.log"),
      time: true,
    },
  ],
  loadEnv,
  filterEnv,
  buildApiEnv,
  buildListenerEnv,
  FORWARD_PREFIXES,
};
