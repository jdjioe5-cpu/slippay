import { assertEquals, assertNotEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  generateApiKey,
  hashApiKey,
  legacyHashApiKey,
  hashCandidates,
  verifyApiKey,
  prefixOf,
} from "../lib/apikey.ts";

if (!Deno.env.get("API_KEY_PEPPER")) {
  Deno.env.set("API_KEY_PEPPER", "test-pepper-at-least-32-characters-long-1234567890");
}

Deno.test("generateApiKey returns sk_live_ + 64 hex", () => {
  const { plain } = generateApiKey();
  if (!plain.startsWith("sk_live_")) throw new Error("missing prefix");
  assertEquals(plain.length, "sk_live_".length + 64);
});

Deno.test("hashApiKey is deterministic and != plain", async () => {
  const k = "sk_live_" + "a".repeat(64);
  const h1 = await hashApiKey(k);
  const h2 = await hashApiKey(k);
  assertEquals(h1, h2);
  assertNotEquals(h1, k);
});

Deno.test("legacyHashApiKey produces standard unsalted sha256 hex", async () => {
  const k = "sk_live_test_plain_key_12345";
  const legacy = await legacyHashApiKey(k);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(k));
  const expected = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  assertEquals(legacy, expected);
});

Deno.test("hashCandidates returns [peppered, legacy] in expected order", async () => {
  const k = "sk_live_" + "b".repeat(64);
  const candidates = await hashCandidates(k);
  assertEquals(candidates.length, 2);

  const peppered = await hashApiKey(k);
  const legacy = await legacyHashApiKey(k);

  assertEquals(candidates[0], peppered);
  assertEquals(candidates[1], legacy);
  assertNotEquals(candidates[0], candidates[1]);
});

Deno.test("verifyApiKey accepts both peppered and legacy hashes (Issue #502)", async () => {
  const { plain } = generateApiKey();
  const peppered = await hashApiKey(plain);
  const legacy = await legacyHashApiKey(plain);

  // Both canonical and legacy hashes verify successfully
  assertEquals(await verifyApiKey(plain, peppered), true);
  assertEquals(await verifyApiKey(plain, legacy), true);

  // Altered keys reject
  const wrongKey = plain.replace(/.$/, "Z");
  assertEquals(await verifyApiKey(wrongKey, peppered), false);
  assertEquals(await verifyApiKey(wrongKey, legacy), false);
});

Deno.test("prefixOf returns prefix plus 4 chars (12 chars total)", () => {
  const prefix = prefixOf("sk_live_abcdefgh1234567890");
  assertEquals(prefix, "sk_live_abcd");
  assertEquals(prefix.length, 12);
});
