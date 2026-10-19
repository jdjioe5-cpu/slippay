import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchOutcome, OrderForMatch } from "./matcher.js";
import { log } from "./log.js";

/**
 * Atomically bumps a subscription's charges_done counter and expires the subscription
 * if max_periods has been reached.
 *
 * Implements optimistic concurrency control (OCC) conditioned on the observed charges_done
 * counter with automatic retry upon concurrent modification, and falls back to / prefers
 * the atomic bump_subscription_charges_done Postgres function when available.
 */
export async function bumpSubscriptionChargesDone(
  db: SupabaseClient,
  subscriptionId: string,
  maxRetries: number = 5,
): Promise<{ charges_done: number; status: string } | null> {
  // 1. Attempt database-side atomic function if available
  try {
    const { data, error } = await db.rpc("bump_subscription_charges_done", { sub_id: subscriptionId });
    if (!error && Array.isArray(data) && data.length > 0) {
      return { charges_done: Number(data[0].charges_done), status: String(data[0].status) };
    }
  } catch {
    // If RPC is unavailable (e.g. mock DB or legacy environment), proceed to OCC loop
  }

  // 2. Application-level optimistic concurrency control (OCC) with conditional write
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data: sub, error: subFetchErr } = await db.from("subscriptions")
      .select("charges_done, max_periods, status").eq("id", subscriptionId).maybeSingle();

    if (subFetchErr || !sub) {
      if (subFetchErr) {
        log("error", "subscription_fetch_failed", { subscription_id: subscriptionId, error: subFetchErr.message });
      }
      return null;
    }

    const observed = sub.charges_done ?? 0;
    const nextCount = observed + 1;
    const reachedMax = sub.max_periods != null && nextCount >= sub.max_periods;

    const patch: Record<string, unknown> = {
      charges_done: nextCount,
      last_charge_at: new Date().toISOString(),
    };
    if (reachedMax) patch.status = "expired";

    // Condition the update on observed charges_done so concurrent updates conflict
    let query = db.from("subscriptions").update(patch).eq("id", subscriptionId);
    if (sub.charges_done === null || sub.charges_done === undefined) {
      query = query.is("charges_done", null);
    } else {
      query = query.eq("charges_done", observed);
    }

    const { data: updated, error: subUpdErr } = await query
      .select("charges_done, status")
      .maybeSingle();

    if (subUpdErr) {
      log("error", "subscription_update_failed", { subscription_id: subscriptionId, error: subUpdErr.message });
      return null;
    }

    if (updated) {
      return {
        charges_done: Number(updated.charges_done),
        status: String(updated.status),
      };
    }

    // Race detected: another worker modified charges_done between our read and write.
    // Retry with exponential backoff.
    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(10 * (2 ** attempt), 100)));
    }
  }

  log("error", "subscription_concurrency_exhausted", { subscription_id: subscriptionId });
  return null;
}

export async function reconcileMatch(
  db: SupabaseClient,
  order: OrderForMatch & { merchant_id: string },
  outcome: MatchOutcome,
  txHash: string,
) {
  if (outcome.outcome === "ignore") return;

  const newStatus = outcome.outcome === "paid" ? "paid" : "underpaid";

  // Allow underpaid → paid transition (audit-003 L3). Without this, a partial
  // payment followed by a top-up leaves the order stuck in underpaid forever
  // and silently drops the second event. The transition matrix here is
  // explicit: only forward transitions, never backward.
  const allowedPriorStatuses = newStatus === "paid"
    ? ["pending", "underpaid"]
    : ["pending"];

  const { data, error } = await db.from("orders")
    .update({ status: newStatus, tx_hash: txHash, paid_at: newStatus === "paid" ? new Date().toISOString() : null })
    .eq("id", order.id)
    .in("status", allowedPriorStatuses)
    .select("*").single();

  if (error || !data) {
    log("warn", "reconcile_skipped", { order_id: order.id, error: error?.message ?? "no_pending_row" });
    return;
  }

  const subscriptionId: string | null = data.subscription_id ?? null;

  // If this order was generated from a subscription and was successfully paid,
  // bump charges_done atomically. If it hits max_periods, expire the subscription.
  if (subscriptionId && newStatus === "paid") {
    await bumpSubscriptionChargesDone(db, subscriptionId);
  }

  const payload = {
    type: outcome.outcome === "paid"
      ? (subscriptionId ? "subscription.charged" : "order.paid")
      : "order.underpaid",
    data: {
      id: order.id,
      subscription_id: subscriptionId,
      external_ref: data.external_ref,
      brl_amount: data.brl_amount,
      usdc_amount: data.usdc_amount,
      tx_hash: txHash,
      memo: order.memo,
      paid_at: data.paid_at,
      ...(outcome.outcome === "underpaid" ? { expected: outcome.expected, received: outcome.received } : {}),
    },
  };

  const { error: webhookError } = await db.from("webhook_deliveries").insert({
    order_id: order.id,
    type: payload.type,
    payload,
  });

  if (webhookError) {
    // 23505 = unique_violation. With the partial unique index on
    // webhook_deliveries(order_id, type) for terminal types, duplicate
    // inserts on Horizon stream replay are expected and silent (audit-003 L3).
    const code = (webhookError as { code?: string }).code;
    if (code === "23505") {
      log("info", "webhook_insert_dedup", { order_id: order.id, type: payload.type });
    } else {
      log("error", "webhook_insert_failed", { order_id: order.id, error: webhookError.message });
    }
  }

  log("info", "order_reconciled", {
    order_id: order.id,
    subscription_id: subscriptionId,
    status: newStatus,
    tx_hash: txHash,
  });
}
