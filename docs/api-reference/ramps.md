# Ramps & Off-ramp API (`/v1/offramp` and `/v1/ramp`)

SlipPay provides a provider-agnostic fiat ramp surface that connects Brazilian Pix with USDC on Stellar. The primary implementation interfaces with **Etherfuse** for hosted KYC and deferred-signed transactions, alongside **CriptoPix** for charge-model Pix on-ramping.

---

## Architecture & Asynchronous Settlement Model

Unlike payment orders where status can be polled synchronously from Horizon, ramp providers operate asynchronously:

1. **Provider-Agnostic Abstraction**: Route handlers in `routes/offramp.ts` invoke the active `Anchor` provider configured via `lib/ramp/index.ts`.
2. **Dormant Gate**: If no provider is configured (`ETHERFUSE_ENABLED !== "1"` or API key missing), authenticated endpoints return `503 Service Unavailable` with `error: "offramp_disabled"`.
3. **Asynchronous Status via Webhook**:
   - Charge-model ramp providers (such as CriptoPix) provide **no GET-by-id status endpoint**.
   - Instead, the provider POSTs an authenticated event to `/api/v1/ramp/criptopix/webhook`.
   - The handler verifies the provider's signature, decodes the payload, and upserts the record into the persistent `ramp_transactions` database store (`lib/ramp/store.ts`).
   - Clients poll `GET /v1/offramp/order/:id` or `GET /v1/offramp/onramp/:id`, which resolves against `ramp_transactions`.
4. **Margin Embed**: SlipPay's operational margin (`SLIPPAY_RAMP_MARGIN_BPS`, defaulting to 190 bps / 1.9%) is applied transparently into all returned quotes via `applyMargin()`.

---

## Endpoints Summary

### Public Diagnostics

#### `GET /api/v1/offramp/status`
Returns provider operational availability and capabilities so client UIs can show or hide cash-out controls without making authenticated requests.

**Response (200 OK — Enabled):**
```json
{
  "enabled": true,
  "provider": "etherfuse",
  "displayName": "Etherfuse Anchor",
  "currencies": ["BRL", "USDC"],
  "rails": ["pix", "stellar"],
  "capabilities": ["onramp", "offramp", "kyc_hosted"]
}
```

**Response (200 OK — Dormant):**
```json
{
  "enabled": false
}
```

---

### Authenticated Operations (`Authorization: Bearer <API_KEY_OR_JWT>`)

#### `POST /api/v1/offramp/quote`
Fetches a firm fiat/crypto conversion rate with SlipPay margin embedded.

**Request Body:**
```json
{
  "fromCurrency": "USDC",
  "toCurrency": "BRL",
  "fromAmount": "50.00",
  "stellarAddress": "GBCW...XYZ"
}
```

**Response (200 OK):**
```json
{
  "quote": {
    "quoteId": "q_ef_98721634",
    "fromCurrency": "USDC",
    "toCurrency": "BRL",
    "fromAmount": "50.00",
    "toAmount": "270.50",
    "rate": "5.41",
    "expiresAt": "2026-10-20T12:00:00Z"
  }
}
```

---

#### `POST /api/v1/offramp/customer`
Registers customer KYC metadata with the provider.

**Request Body:**
```json
{
  "email": "user@example.com",
  "publicKey": "GBCW...XYZ",
  "name": "Maria Silva",
  "taxId": "12345678901",
  "taxIdCountry": "BRA"
}
```

---

#### `GET /api/v1/offramp/kyc-url`
Retrieves a hosted iframe URL for the buyer to complete compliance verification.

**Query Parameters:**
- `customerId` (string, required): Provider customer ID.
- `publicKey` (string, optional): Stellar wallet public key.
- `bankAccountId` (string, optional): Destination bank account ID.

**Response (200 OK):**
```json
{
  "url": "https://verify.etherfuse.com/session/sess_123456"
}
```

---

#### `POST /api/v1/offramp/order` (Create Off-Ramp / Cash Out)
Initiates a USDC to BRL payout order.

**Request Body:**
```json
{
  "customerId": "cust_12345",
  "quoteId": "q_ef_98721634",
  "stellarAddress": "GBCW...XYZ",
  "fromCurrency": "USDC",
  "toCurrency": "BRL",
  "amount": "50.00",
  "fiatAccountId": "fiat_acc_pix_01"
}
```

**Response (201 Created):**
Returns the order descriptor. For deferred-signed flows, the response contains the unsigned transaction payload that the client passkey wallet signs and submits through the relayer.

---

#### `GET /api/v1/offramp/order/:id`
Retrieves the terminal settlement status of an off-ramp payout order.

**Response (200 OK):**
```json
{
  "order": {
    "id": "ord_ef_99812",
    "status": "completed",
    "txHash": "3f8a...bc12",
    "amountPaid": "270.50",
    "currency": "BRL"
  }
}
```

---

#### `POST /api/v1/offramp/onramp` (Fiat Pix -> Crypto)
Creates an on-ramp order. For providers requiring payer identity (e.g., CriptoPix), `identity` (CPF and birth date) must be supplied.

**Request Body:**
```json
{
  "customerId": "cust_12345",
  "quoteId": "q_on_123",
  "stellarAddress": "GBCW...XYZ",
  "fromCurrency": "BRL",
  "toCurrency": "USDC",
  "amount": "100.00",
  "identity": {
    "name": "Joao Souza",
    "email": "joao@example.com",
    "taxId": "98765432100",
    "birthDate": "1990-05-15"
  }
}
```

**Response (201 Created):**
```json
{
  "order": {
    "id": "onramp_123",
    "status": "pending",
    "paymentInstructions": {
      "pixCode": "00020126580014br.gov.bcb.pix..."
    }
  }
}
```

---

## Provider Webhook Contract (`/api/v1/ramp/criptopix/webhook`)

CriptoPix issues status notifications directly to SlipPay's backend:

1. **Authentication**: `Authorization: Bearer <JWT>` signed with HS256 using `CRIPTOPIX_CLIENT_SECRET`.
2. **Payload Verification**:
   - The token must decode to a valid header and payload.
   - If `CRIPTOPIX_BUSINESS_ID` is set, `payload.businessId` must match; otherwise returns `401 Unauthorized` (`business_mismatch`).
3. **Idempotent Store Upsert**:
   - The webhook body is written to `ramp_transactions`.
   - On storage success, responds `200 OK` with `{ ok: true, id: "<key>" }`.
   - On storage failure, returns `502 Bad Gateway` to instruct the provider to retry delivery.
