import type { Context, Next } from "hono";
import { serviceClient } from "../lib/supabase.ts";
import { hashCandidates } from "../lib/apikey.ts";

export async function requireApiKey(c: Context, next: Next) {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer sk_live_")) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  const plain = auth.slice("Bearer ".length);
  const sb = serviceClient();

  // Look up by candidate hashes (canonical peppered first, legacy unsalted second).
  // Candidates are provided by single authority hashCandidates() in lib/apikey.ts.
  // Both branches still go through `.in()` exact-match on the indexed column, so per-row time is constant.
  const candidates = await hashCandidates(plain);
  const { data, error } = await sb
    .from("merchants")
    .select("*")
    .in("api_key_hash", candidates)
    .eq("active", true)
    .maybeSingle();
  if (error || !data) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  c.set("merchant", data);
  c.set("supabase", sb);
  await next();
}
