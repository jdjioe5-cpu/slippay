import { Hono } from "hono";

// Public subscription-intelligence snapshot, sourced from the SlipPay Dune
// dashboard (dune.com/slippay/subscription-intelligence). Public on purpose —
// the whole thesis is "verifiable on-chain, audit it yourself", so no auth.
//
// Two-layer honesty contract:
//   1. If the Dune query IDs / API key aren't configured yet, we return
//      { configured: false } — never fabricated numbers. Per Wave's rule,
//      the dashboard isn't published until >=1 real mainnet charge exists,
//      so this is the expected state until then.
//   2. When configured, we cache successful Dune results for 1h (TTL) so the site can
//      poll cheaply and Dune's rate limit isn't hit on every pageview.
//      Failures are NEVER cached for the full TTL so transient errors are retried
//      on subsequent requests instead of freezing the metric in an error state.
//
// GET /v1/metrics/dune-snapshot
const r = new Hono();

export const DASHBOARD_URL = "https://dune.com/slippay/subscription-intelligence";
export const DEFAULT_CONTRACT_ID = "CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN";
export const TTL_MS = 60 * 60 * 1000; // 1h

export function getStellarNetwork(): "testnet" | "mainnet" {
  return (Deno.env.get("STELLAR_NETWORK")?.toLowerCase() ?? "testnet") as "testnet" | "mainnet";
}

export function getSubscriptionContractId(): string {
  const net = getStellarNetwork();
  return (
    (net === "mainnet"
      ? Deno.env.get("SLIPPAY_SUBSCRIPTION_CONTRACT_MAINNET")
      : Deno.env.get("SLIPPAY_SUBSCRIPTION_CONTRACT_TESTNET")) ??
    DEFAULT_CONTRACT_ID
  );
}

// Maps our 4 metrics to their Dune query IDs (set once the queries are
// published + saved on Dune). Empty string = not yet wired.
export function getQueryIds(): Record<string, string> {
  return {
    active_subscriptions: Deno.env.get("DUNE_Q_ACTIVE") ?? "",
    mrr_usd: Deno.env.get("DUNE_Q_MRR") ?? "",
    churn_30d: Deno.env.get("DUNE_Q_CHURN") ?? "",
    cohort_retention: Deno.env.get("DUNE_Q_COHORT") ?? "",
  };
}

interface MetricCacheEntry {
  at: number;
  data: unknown;
}

const metricCache = new Map<string, MetricCacheEntry>();

export function clearMetricsCache(): void {
  metricCache.clear();
}

export type FetchDuneFn = (queryId: string, apiKey: string) => Promise<unknown>;

export async function defaultFetchDune(queryId: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`https://api.dune.com/api/v1/query/${queryId}/results`, {
    headers: { "X-Dune-API-Key": apiKey },
  });
  if (!res.ok) throw new Error(`dune ${queryId} -> ${res.status}`);
  const json = await res.json();
  return json?.result?.rows ?? [];
}

let activeFetchDune: FetchDuneFn = defaultFetchDune;

export function setFetchDuneForTest(fn: FetchDuneFn | null): void {
  activeFetchDune = fn ?? defaultFetchDune;
}

r.get("/dune-snapshot", async (c) => {
  const apiKey = Deno.env.get("DUNE_API_KEY") ?? "";
  const queryIds = getQueryIds();
  const wired = Object.values(queryIds).filter(Boolean).length;
  const contractId = getSubscriptionContractId();
  const network = getStellarNetwork();

  // Honest unconfigured state — no fabricated numbers.
  if (!apiKey || wired === 0) {
    return c.json({
      configured: false,
      network,
      contract_id: contractId,
      dashboard_url: DASHBOARD_URL,
      note: "Dashboard not published yet — published once real mainnet subscription data exists.",
    });
  }

  const now = Date.now();
  const metrics: Record<string, unknown> = {};

  for (const [name, id] of Object.entries(queryIds)) {
    if (!id) {
      metrics[name] = null;
      continue;
    }

    const cached = metricCache.get(name);
    if (cached && now - cached.at < TTL_MS) {
      metrics[name] = cached.data;
      continue;
    }

    try {
      const data = await activeFetchDune(id, apiKey);
      metricCache.set(name, { at: now, data });
      metrics[name] = data;
    } catch (e) {
      // Do not freeze failed metrics for the 1h TTL window: omit from cache so the
      // next request retries. Return machine-readable failure marker without leaking raw errors.
      console.error(`[metrics] Dune query ${id} for metric ${name} failed:`, e instanceof Error ? e.message : e);
      metrics[name] = { status: "unavailable" };
    }
  }

  const body = {
    configured: true,
    network,
    contract_id: contractId,
    dashboard_url: DASHBOARD_URL,
    fetched_at: new Date(now).toISOString(),
    metrics,
  };
  return c.json(body);
});

export default r;

