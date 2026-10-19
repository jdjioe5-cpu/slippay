import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SharedDailyBudgetStore } from "../lib/spawn_budget.ts";
import { createAskApp } from "../routes/ask.ts";

Deno.test("SharedDailyBudgetStore: reserves and refunds correctly", async () => {
  const store = new SharedDailyBudgetStore({ counts: new Map() });
  const day = "2026-10-19";

  const res1 = await store.tryReserve(day, 2);
  assertEquals(res1.allowed, true);
  assertEquals(res1.remaining, 1);
  assertEquals(res1.count, 1);
  assertEquals(res1.ceiling, 2);

  // Refund res1 (e.g., spawn failed)
  const remainingCount = await store.refund(day);
  assertEquals(remainingCount, 0);

  // Can reserve again since slot was refunded
  const res2 = await store.tryReserve(day, 2);
  assertEquals(res2.allowed, true);
  assertEquals(res2.count, 1);
});

Deno.test("Two API instances share one daily budget and exhaust with 429 containing ceiling", async () => {
  const store = new SharedDailyBudgetStore({ counts: new Map() });
  const day = new Date().toISOString().slice(0, 10);
  const ceiling = 2;

  // Instance 1 and Instance 2 share the same store
  const app1 = createAskApp({ budgetStore: store, maxSpawnsPerDay: ceiling });
  const app2 = createAskApp({ budgetStore: store, maxSpawnsPerDay: ceiling });

  // Mock valid landing page origin request
  const makeReq = (bodyObj: unknown) =>
    new Request("http://localhost/", {
      method: "POST",
      headers: {
        origin: "https://slippay.cc",
        "content-type": "application/json",
      },
      body: JSON.stringify(bodyObj),
    });

  // App 1 takes slot 1 (fails on empty question -> refunds slot!)
  const respFail = await app1.fetch(makeReq({ question: "" }));
  assertEquals(respFail.status, 400);
  // Slot was refunded! Count is 0
  assertEquals(await store.getCount(day), 0);

  // Pre-fill store to ceiling
  await store.tryReserve(day, ceiling);
  await store.tryReserve(day, ceiling);
  assertEquals(await store.getCount(day), 2);

  // Now both App 1 and App 2 must be exhausted (429 with ceiling)
  const resp1Exhausted = await app1.fetch(makeReq({ question: "How does Slippay work?" }));
  assertEquals(resp1Exhausted.status, 429);
  assertEquals(resp1Exhausted.headers.get("retry-after"), "3600");
  const json1 = await resp1Exhausted.json();
  assertEquals(json1.error, "daily_limit_reached");
  assertEquals(json1.ceiling, 2);
  assertEquals(json1.remaining, 0);

  const resp2Exhausted = await app2.fetch(makeReq({ question: "Is there a fee?" }));
  assertEquals(resp2Exhausted.status, 429);
  const json2 = await resp2Exhausted.json();
  assertEquals(json2.error, "daily_limit_reached");
  assertEquals(json2.ceiling, 2);
});

Deno.test("Failed spawn does not consume a daily slot (refund verification)", async () => {
  const store = new SharedDailyBudgetStore({ counts: new Map() });
  const day = new Date().toISOString().slice(0, 10);
  const ceiling = 1;

  const app = createAskApp({ budgetStore: store, maxSpawnsPerDay: ceiling });

  // Question that fails validation (question length > 4000)
  const hugeQuestion = "a".repeat(4005);
  const req = new Request("http://localhost/", {
    method: "POST",
    headers: {
      origin: "https://slippay.cc",
      "content-type": "application/json",
    },
    body: JSON.stringify({ question: hugeQuestion }),
  });

  const resp = await app.fetch(req);
  assertEquals(resp.status, 400);

  // Slot was refunded, count remains 0 rather than being burned by invalid request
  assertEquals(await store.getCount(day), 0);
});
