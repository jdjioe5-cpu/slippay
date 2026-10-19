# Billing & Invoicing API (`/v1/billing`)

The Billing module provides off-chain invoice aggregation for merchants. It tallies the platform fees collected across paid orders during a specified billing window.

---

## Fee Aggregation Model

SlipPay records fees on an individual order basis (`fee_usdc` on the `orders` record). When generating periodical invoices or dashboard summaries:
1. Only orders with terminal status `paid` within `[from, to]` are included.
2. The endpoint computes the aggregate `fee_usdc_total` representing what SlipPay invoices the merchant for the period.
3. `net_usdc_total` represents the merchant's gross sales minus the collected platform fee.

---

## Endpoints

### `GET /api/v1/billing/fees`
Aggregates fees and volume for the authenticated merchant across a given date range.

**Authentication:** `Authorization: Bearer <API_KEY_OR_JWT>` (API key or Supabase JWT session).

**Query Parameters:**
- `from` (string, optional): ISO-8601 start date. Defaults to the first day of the current calendar month.
- `to` (string, optional): ISO-8601 end date. Defaults to the current UTC timestamp.

**Response (200 OK):**
```json
{
  "merchant_id": "merch_123e4567-e89b-12d3-a456-426614174000",
  "period": {
    "from": "2026-10-01T00:00:00.000Z",
    "to": "2026-10-20T01:30:00.000Z"
  },
  "orders_count": 142,
  "gross_usdc": "14200.0000000",
  "fee_usdc_total": "421.7400000",
  "net_usdc_total": "13778.2600000",
  "platform_fee_bp": 297
}
```

**Error Responses:**
- `401 Unauthorized`: Missing or invalid API key / JWT session.
- `400 Bad Request`: Invalid date format or reversed date window.
