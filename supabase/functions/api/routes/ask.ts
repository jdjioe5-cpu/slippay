import { Hono, type Context } from "hono";
import { isAllowedOrigin } from "@slippay/shared";
import { askSlippayStream } from "../lib/ask.ts";
import { rateLimit } from "../middleware/rate_limit.ts";
import {
  type DailyBudgetStore,
  defaultSpawnBudgetStore,
} from "../lib/spawn_budget.ts";

export interface AskRouteOptions {
  budgetStore?: DailyBudgetStore;
  maxSpawnsPerDay?: number;
  maxConcurrent?: number;
}

export function createAskApp(options: AskRouteOptions = {}) {
  const budgetStore = options.budgetStore ?? defaultSpawnBudgetStore;
  const maxSpawnsPerDay = options.maxSpawnsPerDay ?? (() => {
    const raw = typeof Deno !== "undefined" ? Deno.env.get("ASK_MAX_SPAWNS_PER_DAY") : undefined;
    const n = raw ? Number.parseInt(raw, 10) : 500;
    return Number.isFinite(n) && n > 0 ? n : 500;
  })();
  const maxConcurrent = options.maxConcurrent ?? 4;
  let inFlight = 0;

  const app = new Hono();

  // Audit-004 · C7 — Per-IP token bucket limits
  app.use("*", rateLimit({ capacity: 5, refillPerSec: 5 / 60, scope: "ask_per_minute" }));
  app.use("*", rateLimit({ capacity: 100, refillPerSec: 100 / 86_400, scope: "ask_per_day" }));

  // POST /v1/ask — Ask Slippay AI chat widget endpoint.
  app.post("/", async (c) => {
    // 1. Origin gate: FAIL-CLOSED
    const origin = c.req.header("origin");
    const referer = c.req.header("referer");
    const candidate = origin ?? referer;
    if (!candidate) {
      return c.json({ error: "origin_required" }, 403);
    }
    let candidateOrigin: string;
    try {
      candidateOrigin = new URL(candidate).origin;
    } catch {
      return c.json({ error: "origin_not_allowed" }, 403);
    }
    if (!isAllowedOrigin(candidateOrigin)) {
      return c.json({ error: "origin_not_allowed" }, 403);
    }

    // 2. Deployment-wide daily spawn budget check
    const today = new Date().toISOString().slice(0, 10);
    const reservation = await budgetStore.tryReserve(today, maxSpawnsPerDay);
    if (!reservation.allowed) {
      return c.json(
        {
          error: "daily_limit_reached",
          ceiling: maxSpawnsPerDay,
          max_spawns_per_day: maxSpawnsPerDay,
          remaining: 0,
          detail: `Ask Slippay daily capacity reached (${maxSpawnsPerDay} spawns); try again tomorrow.`,
        },
        429,
        { "retry-after": "3600" },
      );
    }

    let spawnReserved = true;
    const refundSpawn = () => {
      if (spawnReserved) {
        spawnReserved = false;
        budgetStore.refund(today).catch(() => {});
      }
    };

    // 3. Concurrency check
    if (inFlight >= maxConcurrent) {
      refundSpawn();
      return c.json(
        { error: "busy", detail: "too many concurrent requests; retry shortly" },
        503,
      );
    }

    inFlight += 1;
    try {
      return await handleAsk(c, refundSpawn);
    } finally {
      inFlight -= 1;
    }
  });

  return app;
}

async function handleAsk(c: Context, refundSpawn: () => void) {
  let body: { question?: string; history?: unknown };
  try {
    body = await c.req.json();
  } catch {
    refundSpawn();
    return c.json({ error: "invalid_json" }, 400);
  }
  const question = (body.question ?? "").toString().trim();
  if (!question || question.length > 4000) {
    refundSpawn();
    return c.json({ error: "invalid_question", detail: "expected 1-4000 chars" }, 400);
  }
  const history = Array.isArray(body.history)
    ? (body.history as Array<{ role: "user" | "assistant"; content: string }>)
      .filter(h => (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
      .slice(-10)  // limit to last 10 turns for cost
    : undefined;

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await askSlippayStream({
      question,
      history,
      onSpawnFailure: refundSpawn,
    });
  } catch (e: unknown) {
    refundSpawn();
    const msg = String((e as Error).message ?? e);
    if (msg.includes("CLAUDE_CODE_OAUTH_TOKEN") || msg.includes("ANTHROPIC_API_KEY")) {
      return c.json(
        { error: "service_unavailable", detail: "Ask Slippay engine not configured. Contact admin." },
        503,
      );
    }
    return c.json({ error: "stream_failed", detail: msg }, 500);
  }

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    },
  });
}

const defaultApp = createAskApp();
export default defaultApp;
