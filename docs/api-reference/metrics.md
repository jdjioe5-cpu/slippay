# On-Chain Metrics & Dune Snapshots (`/v1/metrics`)

The Metrics surface exposes public, verifiable on-chain subscription intelligence aggregated from Dune Analytics (`dune.com/slippay/subscription-intelligence`).

---

## Verifiability & Honesty Contract

The endpoint is intentionally public (no authentication required) to uphold the principle that settlement intelligence is verifiable on-chain by any third party.

1. **Honest Unconfigured State**: If Dune query IDs or API keys are not yet configured in the environment, the endpoint returns `{ "configured": false }` with a note explaining the dashboard publishes once live mainnet charges occur. It **never fabricates placeholder numbers**.
2. **One-Hour Cache TTL**: When configured, responses are cached in memory for 1 hour (`TTL_MS = 3600000`) so high-traffic web visitors do not exhaust upstream Dune rate limits.

---

## Endpoints

### `GET /api/v1/metrics/dune-snapshot`
Fetches the current subscription metrics snapshot.

**Authentication:** None (Public).

**Response (200 OK — Configured):**
```json
{
  "configured": true,
  "contract_id": "CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN",
  "dashboard_url": "https://dune.com/slippay/subscription-intelligence",
  "fetched_at": "2026-10-20T01:00:00.000Z",
  "metrics": {
    "active_subscriptions": [{ "active_count": 312 }],
    "mrr_usd": [{ "mrr": 15420.00 }],
    "churn_30d": [{ "churn_rate_pct": 2.1 }],
    "cohort_retention": [{ "month": "2026-09", "retention": 94.5 }]
  }
}
```

**Response (200 OK — Unconfigured):**
```json
{
  "configured": false,
  "contract_id": "CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN",
  "dashboard_url": "https://dune.com/slippay/subscription-intelligence",
  "note": "Dashboard not published yet — published once real mainnet subscription data exists."
}
```
