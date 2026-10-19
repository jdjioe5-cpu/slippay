# Ask Slippay AI Assistant API (`/v1/ask`)

The `/v1/ask` endpoint powers the real-time AI assistant embedded on the SlipPay landing page, streaming answers and documentation citations via Server-Sent Events (SSE).

---

## Access & Protection Controls

Because the assistant is invoked directly by prospective merchants and developers from their browsers before creating an account, it does not require an API key. Instead, the endpoint is protected by four defense-in-depth layers:

1. **Origin Allowlist**: Requests must carry an `Origin` or `Referer` belonging to `ALLOWED_ORIGINS_SET` (e.g. `slippay.cc`, `app.slippay.cc`).
2. **Per-IP Rate Limiting**: Token-bucket limiters enforce a maximum of 5 requests/minute sustained and 100 requests/day per source IP.
3. **Concurrency Semaphore**: A hard cap (`MAX_CONCURRENT_SUBPROCESSES = 4`) prevents container exhaustion during flash traffic.
4. **Daily Process Spawn Ceiling**: Caps daily subprocess invocations across the entire container (`MAX_SPAWNS_PER_DAY = 500`).

---

## Endpoints

### `POST /api/v1/ask`
Submits a user query and returns a streaming response.

**Headers:**
- `Content-Type: application/json`
- `Origin: https://slippay.cc`

**Request Body:**
```json
{
  "question": "How does biometric face-id authorization work on Stellar?",
  "history": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi! How can I help you today?" }
  ]
}
```

**Response (200 OK — `Content-Type: text/event-stream`):**
Streams a sequence of JSON SSE messages:

```
data: {"type": "text", "text": "SlipPay uses a Soroban smart-wallet..."}

data: {"type": "citation", "citation": {"title": "Biometric Pay Guide", "url": "/guides/biometric-pay.md"}}

data: {"type": "usage", "usage": {"inputTokens": 182, "outputTokens": 95}}

data: {"type": "done"}
```
