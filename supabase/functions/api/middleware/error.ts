import type { Context, Next } from "hono";
import { ZodError } from "zod";
import { redactSensitiveQueryParams } from "../lib/security.ts";

// Audit-004 · C3+M1 — Zod issues are useful for developers calling the API
// directly, but in production we don't want to echo field names / regex
// patterns. Toggle by ZOD_VERBOSE env (default: terse).
const VERBOSE_ZOD = Deno.env.get("ZOD_VERBOSE") === "1";

export async function errorMiddleware(c: Context, next: Next) {
  try {
    await next();
  } catch (e) {
    if (e instanceof ZodError) {
      const body: Record<string, unknown> = { error: "validation_error" };
      if (VERBOSE_ZOD) body.issues = e.issues;
      return c.json(body, 400);
    }
    // Server-side log keeps full detail for ops with URL query secrets redacted.
    console.error("api_error", redactSensitiveQueryParams(c.req.url), e);
    return c.json({ error: "internal_error" }, 500);
  }
}
