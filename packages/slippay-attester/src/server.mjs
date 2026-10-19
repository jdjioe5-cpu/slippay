#!/usr/bin/env node
// SlipPay integrity oracle — HTTP service (zero web deps, Node http).
//
// Endpoints:
//   GET  /pubkey                     → [Public] the attester ed25519 key (register it via
//                                       the Soroban set_attester, or verify anywhere)
//   POST /verify   {subscription_id, charges_done, not_after, signature, pubkey}
//                                     → [Public] { valid }
//   POST /register {agent_id, allowed_recipients, allowed_tools?, max_amount}
//                                     → [Authenticated] commits surface and binds agent_id
//                                       to the authenticated caller principal. Re-registration
//                                       by another principal is strictly forbidden (403).
//   POST /attest   {agent_id, subscription_id, charges_done, recipient, amount, tools_used?}
//                                     → [Authenticated] verifies caller principal ownership
//                                       and signs attestation iff within committed surface.
//
// Security & Authentication Model:
//   - Authenticated endpoints require an HTTP header:
//       Authorization: Bearer <token>   OR   X-API-Key: <key>
//   - Allowed credentials are configured via:
//       SLIPPAY_ATTESTER_API_KEYS: JSON object ({"<key>": "<principal_id>"}) or comma-separated keys.
//       SLIPPAY_ATTESTER_AUTH_TOKEN: Master administrative token (principal: "admin").
//   - CORS is strictly restricted to origins declared in SLIPPAY_ATTESTER_ALLOWED_ORIGINS
//     (comma-separated). Wildcard "*" is strictly rejected.
//   - Key management: SLIPPAY_ATTESTER_SECRET (64 hex characters / 32 bytes) is required.
//     Under NODE_ENV=production, dev keys are unconditionally refused.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha256";
import { commitSurface, attest, verifyAttestation, publicKeyHex, hexToBytes, getSurfaceOwner } from "./oracle.mjs";

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

export function parseAuthPrincipal(req, env = process.env) {
  const authHeader = req.headers["authorization"] || "";
  const apiKeyHeader = req.headers["x-api-key"] || "";
  let token = "";
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (typeof apiKeyHeader === "string" && apiKeyHeader.trim()) {
    token = apiKeyHeader.trim();
  }

  if (!token) return null;

  // 1. JSON mapping: {"secret-token-alice": "alice", ...}
  if (env.SLIPPAY_ATTESTER_API_KEYS) {
    try {
      const mapping = JSON.parse(env.SLIPPAY_ATTESTER_API_KEYS);
      if (typeof mapping === "object" && mapping !== null && mapping[token]) {
        return String(mapping[token]);
      }
    } catch {
      const keys = env.SLIPPAY_ATTESTER_API_KEYS.split(",").map((k) => k.trim());
      const idx = keys.indexOf(token);
      if (idx !== -1) return `principal-${idx + 1}`;
    }
  }

  // 2. Master auth token
  if (env.SLIPPAY_ATTESTER_AUTH_TOKEN && token === env.SLIPPAY_ATTESTER_AUTH_TOKEN.trim()) {
    return "admin";
  }

  // 3. Dev opt-in fallback tokens
  if (env.SLIPPAY_ATTESTER_ALLOW_DEV_KEY === "1" || env.SLIPPAY_ATTESTER_ALLOW_DEV_KEY === "true") {
    if (token === "dev-token" || token.startsWith("principal-")) {
      return token.startsWith("principal-") ? token : "dev-principal";
    }
  }

  return null;
}

export function applyCorsHeaders(req, res, env = process.env) {
  const rawAllowed = env.SLIPPAY_ATTESTER_ALLOWED_ORIGINS || "";
  const allowed = rawAllowed.split(",").map((o) => o.trim().toLowerCase()).filter(Boolean);
  const origin = req.headers["origin"];
  if (origin && typeof origin === "string" && allowed.includes(origin.toLowerCase())) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type, authorization, x-api-key");
  }
}

const body = (req) => new Promise((res) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { res(d ? JSON.parse(d) : {}); } catch { res({}); } }); });
const sendJson = (req, res, code, obj, env) => {
  applyCorsHeaders(req, res, env);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

export function createAttesterServer(priv, env = process.env) {
  return createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        applyCorsHeaders(req, res, env);
        res.writeHead(204);
        res.end();
        return;
      }

      // Public endpoints
      if (req.method === "GET" && req.url === "/pubkey") {
        return sendJson(req, res, 200, { pubkey: await publicKeyHex(priv) }, env);
      }
      if (req.method === "POST" && req.url === "/verify") {
        return sendJson(req, res, 200, await verifyAttestation(await body(req)), env);
      }

      // Authenticated endpoints: /register & /attest
      if (req.method === "POST" && (req.url === "/register" || req.url === "/attest")) {
        const principal = parseAuthPrincipal(req, env);
        if (!principal) {
          return sendJson(req, res, 401, { error: "unauthorized: valid authorization credentials required" }, env);
        }

        const payload = await body(req);

        if (req.url === "/register") {
          const agentId = payload.agent_id;
          if (!agentId) return sendJson(req, res, 400, { error: "agent_id required" }, env);
          
          const existingOwner = getSurfaceOwner(agentId);
          if (existingOwner && existingOwner !== principal) {
            return sendJson(req, res, 403, {
              error: `forbidden: agent_id "${agentId}" is owned by principal "${existingOwner}" and cannot be re-registered by "${principal}"`
            }, env);
          }

          const commitment = commitSurface(payload, principal);
          return sendJson(req, res, 200, { commitment, owner: principal }, env);
        }

        if (req.url === "/attest") {
          const agentId = payload.agent_id;
          if (!agentId) return sendJson(req, res, 400, { ok: false, error: "agent_id required" }, env);

          const existingOwner = getSurfaceOwner(agentId);
          if (existingOwner && existingOwner !== principal) {
            return sendJson(req, res, 403, {
              ok: false,
              error: `forbidden: agent_id "${agentId}" is owned by principal "${existingOwner}"`
            }, env);
          }

          const v = await attest(payload, priv);
          return sendJson(req, res, v.ok ? 200 : 403, v, env);
        }
      }

      sendJson(req, res, 404, { error: "not found" }, env);
    } catch (e) {
      sendJson(req, res, 400, { error: String(e?.message ?? e) }, env);
    }
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  try {
    const PORT = Number(process.env.PORT || 8790);
    const { priv, kind } = resolveAttesterSecret(process.env);
    const server = createAttesterServer(priv, process.env);
    server.listen(PORT, async () => {
      process.stderr.write(`slippay-attester on :${PORT} · attester ${await publicKeyHex(priv)} · key=${kind} · auth=active\n`);
    });
  } catch (err) {
    process.stderr.write(`[FATAL] ${err.message}\n`);
    process.exit(1);
  }
}
