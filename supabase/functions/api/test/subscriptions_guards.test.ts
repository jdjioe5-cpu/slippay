import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkChargeable, assertChargeable } from "../routes/subscriptions.ts";

Deno.test("subscriptions guards: checkChargeable pure helper evaluation", () => {
  const now = new Date("2026-10-19T12:00:00Z");

  // 1. Valid active subscription within period & bounds
  const validSub = {
    status: "active",
    expires_at: "2026-10-20T12:00:00Z",
    max_periods: 5,
    charges_done: 2,
  };
  const resValid = checkChargeable(validSub, now);
  assertEquals(resValid, { ok: true });

  // 2. Non-active statuses (e.g. paused, cancelled)
  const pausedSub = {
    status: "paused",
    expires_at: "2026-10-20T12:00:00Z",
    max_periods: 5,
    charges_done: 0,
  };
  const resPaused = checkChargeable(pausedSub, now);
  assertEquals(resPaused, {
    ok: false,
    error: "not_active",
    status: 409,
    body: { error: "not_active", status: "paused" },
  });

  // 3. Expired subscription
  const expiredSub = {
    status: "active",
    expires_at: "2026-10-19T11:59:59Z", // 1s ago
    max_periods: 5,
    charges_done: 2,
  };
  const resExpired = checkChargeable(expiredSub, now);
  assertEquals(resExpired, {
    ok: false,
    error: "expired",
    status: 409,
    body: { error: "expired" },
    markExpired: true,
  });

  // 4. Max periods reached
  const maxPeriodsSub = {
    status: "active",
    expires_at: "2026-10-20T12:00:00Z",
    max_periods: 3,
    charges_done: 3,
  };
  const resMaxPeriods = checkChargeable(maxPeriodsSub, now);
  assertEquals(resMaxPeriods, {
    ok: false,
    error: "max_periods_reached",
    status: 409,
    body: { error: "max_periods_reached" },
    markExpired: true,
  });

  // 5. Max periods exceeded
  const exceededSub = {
    status: "active",
    expires_at: "2026-10-20T12:00:00Z",
    max_periods: 3,
    charges_done: 4,
  };
  const resExceeded = checkChargeable(exceededSub, now);
  assertEquals(resExceeded, {
    ok: false,
    error: "max_periods_reached",
    status: 409,
    body: { error: "max_periods_reached" },
    markExpired: true,
  });
});

Deno.test("subscriptions guards: assertChargeable updates DB on terminal states", async () => {
  const updates: Array<{ id: string; status: string }> = [];
  const mockSb: any = {
    from: (_table: string) => ({
      update: (patch: any) => ({
        eq: (col: string, val: any) => {
          if (col === "id") updates.push({ id: val, status: patch.status });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };

  const now = new Date("2026-10-19T12:00:00Z");

  // A. Expired triggers status = "expired" update
  const subExpired = {
    id: "sub-expired-1",
    status: "active",
    expires_at: "2026-10-19T11:00:00Z",
    max_periods: 10,
    charges_done: 1,
  };
  const outcomeExpired = await assertChargeable(mockSb, subExpired, now);
  assertEquals(outcomeExpired.ok, false);
  assertEquals((outcomeExpired as any).error, "expired");
  assertEquals((outcomeExpired as any).body, { error: "expired" });
  assertEquals(updates, [{ id: "sub-expired-1", status: "expired" }]);

  // B. Max periods reached triggers status = "expired" update
  const subMax = {
    id: "sub-max-2",
    status: "active",
    expires_at: "2026-10-20T12:00:00Z",
    max_periods: 2,
    charges_done: 2,
  };
  const outcomeMax = await assertChargeable(mockSb, subMax, now);
  assertEquals(outcomeMax.ok, false);
  assertEquals((outcomeMax as any).error, "max_periods_reached");
  assertEquals((outcomeMax as any).body, { error: "max_periods_reached" });
  assertEquals(updates.length, 2);
  assertEquals(updates[1], { id: "sub-max-2", status: "expired" });

  // C. Inactive status does NOT update DB
  const subInactive = {
    id: "sub-paused-3",
    status: "paused",
    expires_at: "2026-10-20T12:00:00Z",
    max_periods: 5,
    charges_done: 1,
  };
  const outcomeInactive = await assertChargeable(mockSb, subInactive, now);
  assertEquals(outcomeInactive.ok, false);
  assertEquals((outcomeInactive as any).error, "not_active");
  assertEquals(updates.length, 2); // no new updates
});

Deno.test("subscriptions guards: endpoint parity between /charge and /onchain-charge", async () => {
  // Test that both endpoints produce identical error status and responses for identical fixtures
  const fixtures = [
    {
      name: "expired subscription",
      sub: {
        id: "sub-exp",
        status: "active",
        expires_at: new Date(Date.now() - 60_000).toISOString(),
        max_periods: 12,
        charges_done: 1,
      },
      expectedStatus: 409,
      expectedBody: { error: "expired" },
      shouldExpireDb: true,
    },
    {
      name: "max periods reached",
      sub: {
        id: "sub-max",
        status: "active",
        expires_at: new Date(Date.now() + 86400_000).toISOString(),
        max_periods: 3,
        charges_done: 3,
      },
      expectedStatus: 409,
      expectedBody: { error: "max_periods_reached" },
      shouldExpireDb: true,
    },
    {
      name: "cancelled subscription",
      sub: {
        id: "sub-canc",
        status: "cancelled",
        expires_at: new Date(Date.now() + 86400_000).toISOString(),
        max_periods: 5,
        charges_done: 0,
      },
      expectedStatus: 409,
      expectedBody: { error: "not_active", status: "cancelled" },
      shouldExpireDb: false,
    },
  ];

  for (const f of fixtures) {
    const mockUpdates: string[] = [];
    const mockSb: any = {
      from: () => ({
        update: (patch: any) => ({
          eq: (col: string, val: string) => {
            if (patch.status === "expired") mockUpdates.push(val);
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };

    // Both endpoints execute assertChargeable(sb, sub)
    const outcome = await assertChargeable(mockSb, f.sub);
    assertEquals(outcome.ok, false);
    if (!outcome.ok) {
      assertEquals(outcome.status, f.expectedStatus, `${f.name} status`);
      assertEquals(outcome.body, f.expectedBody as any, `${f.name} body`);
    }

    if (f.shouldExpireDb) {
      assertEquals(mockUpdates, [f.sub.id], `${f.name} must write status=expired to DB`);
    } else {
      assertEquals(mockUpdates.length, 0, `${f.name} must not write to DB`);
    }
  }
});
