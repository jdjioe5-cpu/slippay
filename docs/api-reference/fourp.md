# 4P Finance Ramp API (`/v1/4p`)

The 4P Finance module provides a direct Pix-to-crypto on-ramp and crypto-to-Pix off-ramp integration. Because 4P uses a server-to-server API with private API keys, all calls are mediated by SlipPay's backend to avoid exposing credentials to client browsers.

---

## Security Model & Fail-Closed Controls

### 1. Dormant State Fail-Closed
When `FOURP_API_KEY` is not present in the environment, the service operates in dormant mode:
- `GET /v1/4p/status` returns `{ "enabled": false }`.
- All operational endpoints return `503 Service Unavailable` with `error: "ramp_disabled"`.

### 2. Critical Off-Ramp Receiver Pinning Assertion
In an off-ramp (sell) flow, the end-user initiates a crypto transfer to 4P's intermediary wallet, and 4P deposits Brazilian Reais to the destination Pix key. 

To eliminate man-in-the-middle or upstream account compromise risks:
- SlipPay enforces **server-side address pinning** via `FOURP_OFFRAMP_RECEIVER`.
- During `POST /v1/4p/offramp`, the backend compares 4P's returned `receiver_wallet` against `FOURP_OFFRAMP_RECEIVER`.
- If the addresses differ in any way, SlipPay **fails closed immediately**, returning:
  ```json
  {
    "error": "receiver_mismatch",
    "message": "4P receiver did not match the pinned address"
  }
  ```
  with HTTP status `502 Bad Gateway`. The user client is never provided an unverified target address to sign transfers against.

### 3. Origin Allowlist & Defense-in-Depth
Frontend endpoints (`/quote`, `/onramp`, `/offramp`) validate the `Origin` or `Referer` header against SlipPay's trusted origin allowlist (`ALLOWED_ORIGINS_SET`) and apply strict token-bucket rate limits.

---

## Two-Step Webhook Status Resolution (`POST /v1/4p/webhook`)

4P Finance does not include transaction state in its webhook POST payload. Instead, it sends a lightweight notification token:
1. 4P issues an HTTP POST with `{ "token": "<notification_token>" }`.
2. SlipPay verifies the token by making an authenticated back-channel request to 4P via `client.getNotification(token)`.
3. The authenticated notification object is extracted and committed to `ramp_transactions` via `saveRampTx()`.
4. The client polls `GET /v1/4p/onramp/:id` or `GET /v1/4p/offramp/:id` to read the stored status.

---

## Endpoints

### 1. `GET /api/v1/4p/status`
Checks if the 4P integration is active.

**Response (200 OK):**
```json
{
  "enabled": true,
  "provider": "4p",
  "chain": "Base",
  "asset": "USDC",
  "rails": ["pix"]
}
```

---

### 2. `POST /api/v1/4p/quote`
Calculates crypto output for a given BRL amount, incorporating SlipPay's spread (`FOURP_MARGIN_BPS`, default 280 bps / 2.8%).

**Request Body:**
```json
{
  "amountBrl": 500.00
}
```

**Response (200 OK):**
```json
{
  "quote": {
    "quote": {
      "USDC": { "price": 91.24 }
    }
  },
  "gross": {
    "USDC": 93.87
  },
  "marginBps": 280
}
```

---

### 3. `POST /api/v1/4p/onramp`
Creates a Pix charge for fiat purchase.

**Request Body:**
```json
{
  "amountBrl": 250.00,
  "receiverWallet": "0x71C...3a",
  "email": "buyer@example.com",
  "cpf": "12345678901",
  "description": "Order #4092"
}
```

**Response (201 Created):**
```json
{
  "order": {
    "id": "slp-123e4567-e89b-12d3-a456-426614174000",
    "txid": "4p_tx_789456",
    "pixCopiaECola": "00020126580014br.gov.bcb.pix...",
    "status": "pending"
  }
}
```

---

### 4. `POST /api/v1/4p/offramp/quote`
Fetches a withdrawal quote for converting USDC to BRL.

**Request Body:**
```json
{
  "amountUsdc": 100.00
}
```

**Response (200 OK):**
```json
{
  "brlOut": 526.40,
  "receiver": "0x4P...ReceiverWalletAddress",
  "asset": "USDC",
  "marginBps": 280
}
```

---

### 5. `POST /api/v1/4p/offramp`
Initiates a crypto sell order to Brazilian Reais via Pix.

**Request Body:**
```json
{
  "amountUsdc": 100.00,
  "pixKey": "+5511999998888",
  "senderWallet": "0xUser...Wallet",
  "email": "seller@example.com",
  "cpf": "12345678901"
}
```

**Response (201 Created):**
```json
{
  "id": "slp-off-987f6543-a21b-43d2-a123-526614174000",
  "receiver": "0x4P...PinnedReceiverWallet",
  "amount": "100.00"
}
```
*(Fails with `502 receiver_mismatch` if the returned receiver does not strictly match `FOURP_OFFRAMP_RECEIVER`.)*
