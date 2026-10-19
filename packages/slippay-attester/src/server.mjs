#!/usr/bin/env node
// SlipPay integrity oracle — HTTP service (zero web deps, Node http).
// The chain-agnostic endpoint any rail calls before settling:
//   GET  /pubkey                     → the attester ed25519 key (register it via
//                                       the Soroban set_attester, or verify anywhere)
//   POST /register {agent_id, allowed_recipients, allowed_tools?, max_amount}
//                                     → commits the agent's surface, returns commitment
//   POST /attest   {agent_id, subscription_id, charges_done, recipient, amount, tools_used?}
//                                     → { ok, not_after, signature } | { ok:false, reason }
//   POST /verify   {subscription_id, charges_done, not_after, signature, pubkey}
//                                     → { valid }
//
// Key: SLIPPAY_ATTESTER_SECRET (64-hex / 32 bytes). If unset in dev, setting
// SLIPPAY_ATTESTER_ALLOW_DEV_KEY=1 allows dev fallback. Under production,
// a real 32-byte secret is strictly required.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha256";
import { commitSurface, attest, verifyAttestation, publicKeyHex, hexToBytes } from "./oracle.mjs";

export function resolveAttesterSecret(env = process.env) {
  const secret = env.SLIPPAY_ATTESTER_SECRET?.trim();
  const isProd = env.NODE_ENV === "production";
  const allowDev = env.SLIPPAY_ATTESTER_ALLOW_DEV_KEY === "1" || env.SLIPPAY_ATTESTER_ALLOW_DEV_KEY === "true";

  if (secret) {
    let bytes;
    try {
      bytes = hexToBytes(secret);
    } catch {
      throw new Error("SLIPPAY_ATTESTER_SECRET is invalid: failed to parse hex string");
    }
    if (bytes.length !== 32) {
      throw new Error(`SLIPPAY_ATTESTER_SECRET is invalid: decoded length is ${bytes.length} bytes, expected 32 bytes`);
    }
    return { priv: bytes, kind: "env" };
  }

  if (isProd) {
    throw new Error("SLIPPAY_ATTESTER_SECRET is required when NODE_ENV=production; development signing key is strictly prohibited");
  }

  if (!allowDev) {
    throw new Error("SLIPPAY_ATTESTER_SECRET is not set — refusing to start with insecure development seed. Set SLIPPAY_ATTESTER_SECRET or explicitly set SLIPPAY_ATTESTER_ALLOW_DEV_KEY=1 for development.");
  }

  process.stderr.write("[WARNING] SLIPPAY_ATTESTER_ALLOW_DEV_KEY is active: starting with well-known insecure dev seed!\n");
  const devKey = sha256(new TextEncoder().encode("slippay-attester-dev-seed"));
  return { priv: devKey, kind: "DEV-seed" };
}

export const parseBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data || !data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        const parseErr = new Error(`malformed_json: ${err.message}`);
        parseErr.statusCode = 400;
        reject(parseErr);
      }
    });
    req.on("error", reject);
  });

const json = (r, code, obj) => {
  r.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  r.end(JSON.stringify(obj));
};

export function createAttesterServer(priv) {
  return createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/pubkey") return json(res, 200, { pubkey: await publicKeyHex(priv) });
      if (req.method === "POST" && req.url === "/register") return json(res, 200, { commitment: commitSurface(await parseBody(req)) });
      if (req.method === "POST" && req.url === "/attest") {
        const v = await attest(await parseBody(req), priv);
        return json(res, v.ok ? 200 : 403, v); // 403 when the agent is refused — fail-closed
      }
      if (req.method === "POST" && req.url === "/verify") return json(res, 200, await verifyAttestation(await parseBody(req)));
      json(res, 404, { error: "not found" });
    } catch (e) {
      json(res, e.statusCode || 400, { error: String(e?.message ?? e) });
    }
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  try {
    const PORT = Number(process.env.PORT || 8790);
    const { priv, kind } = resolveAttesterSecret(process.env);
    const server = createAttesterServer(priv);
    server.listen(PORT, async () => {
      process.stderr.write(`slippay-attester on :${PORT} · attester ${await publicKeyHex(priv)} · key=${kind}\n`);
    });
  } catch (err) {
    process.stderr.write(`[FATAL] ${err.message}\n`);
    process.exit(1);
  }
}
