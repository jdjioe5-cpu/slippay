# API Reference Overview

This reference documents the complete live HTTP API exposed by SlipPay's API gateway (`api.slippay.cc/api`), mounted in `supabase/functions/api/index.ts`.

## Live Route Table

Every mounted route group is documented below, grouped by category and access tier:

| Route Path | Module | Authentication | Category | Description |
|---|---|---|---|---|
| `/v1/merchants` | `merchants.ts` | Public (signup) / Supabase JWT | Core Commerce | Merchant registration, profiles, and API key rotation. |
| `/v1/orders` | `orders.ts` | API Key (`sk_live_...`) / Client Token | Core Commerce | Payment order creation, verification, cancellation, and receipt polling. |
| `/v1/subscriptions` | `subscriptions.ts` | API Key (`sk_live_...`) | Core Commerce | Recurring billing mandates, subscriber contracts, charges, and plan lifecycle. |
| `/v1/webhooks` | `webhooks.ts` | HMAC-SHA256 Signature | Event Delivery | Webhook delivery notifications, payload formats, and verification. |
| `/v1/billing` | `billing.ts` | API Key or Supabase JWT | Merchant Operations | Periodic billing aggregation, platform fee totals, and invoicing data. |
| `/v1/metrics` | `metrics.ts` | Public (No Auth) | Transparency | Public on-chain subscription intelligence snapshots cached from Dune. |
| `/v1/x402-resources` & `/v1/x402` | `x402.ts` | API Key (register) / Public (gated GET) | Protocol Extension | HTTP 402 Payment Required content gating with Stellar USDC micro-settlement. |
| `/v1/relayer` | `relayer.ts` | Public (Rate-Limited) | Infrastructure | Gas-sponsor transaction relayer for biometric (Face ID) passkey smart-wallets. |
| `/v1/offramp` | `offramp.ts` | API Key or Supabase JWT | Liquidity & Ramps | Provider-agnostic on/off-ramp surface (quotes, KYC iframe, Pix orders). |
| `/v1/ramp` | `ramp.ts` | Bearer JWT (Provider Shared Secret) | Liquidity & Ramps | Provider webhook receiver (CriptoPix) syncing settlement to `ramp_transactions`. |
| `/v1/4p` | `fourp.ts` | Origin-Gated + Rate-Limited | Liquidity & Ramps | 4P Finance Pix on/off-ramp channel with strict receiver-pinning security. |
| `/v1/ask` | `ask.ts` | Public (Origin-Gated + Rate-Limited) | Landing & Support | Streaming Server-Sent Events (SSE) AI assistant widget. |
| `/health` | `index.ts` | Public | Operations | Health probe endpoint returning `{ ok: true }`. |

---

## Authentication Schemes

SlipPay uses four distinct access control schemes across its route groups:

1. **Merchant Server-to-Server (`Authorization: Bearer sk_live_...`)**: High-entropy 256-bit API keys used for `/v1/orders`, `/v1/subscriptions`, `/v1/x402-resources`, `/v1/billing`, and `/v1/offramp`.
2. **Merchant Dashboard User (`Authorization: Bearer eyJ...`)**: Supabase Auth JWT identifying the authenticated dashboard administrator. Accepted interchangeably on `/v1/billing`, `/v1/offramp`, and `/v1/merchants/me/*`.
3. **Provider-to-Server Webhook Auth**:
   - Standard merchant webhooks: `X-Slippay-Signature: t=<timestamp>,v1=<hex>`.
   - CriptoPix ramp webhooks (`/v1/ramp`): `Authorization: Bearer <JWT>` signed HS256 with partner `clientSecret`.
   - 4P Finance webhooks (`/v1/4p/webhook`): Two-step notification pull resolving token against 4P server API key.
4. **Public Gated Surfaces (Rate-Limited & Origin-Gated)**:
   - `/v1/relayer`: Keyed on the trusted outer client IP; fee and op caps enforced.
   - `/v1/4p` (quote/onramp/offramp) and `/v1/ask`: Origin/Referer allowlist checked against `ALLOWED_ORIGINS_SET` with token-bucket rate limiters.
