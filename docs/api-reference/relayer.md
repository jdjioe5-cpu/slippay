# Gas-Sponsor Relayer API (`/v1/relayer`)

The Relayer service sponsors network fees on Stellar Soroban so end-users can transact seamlessly with Face ID / biometric passkey wallets without needing classic XLM balances.

---

## Non-Custodial Architecture & Trust Boundary

### Why a Relayer is Required
Under the Soroban protocol, an account executing a transaction must be a classic Stellar keypair to pay the base ledger fee; a smart contract (such as a passkey wallet) cannot serve as the outer transaction source. SlipPay provides a gas sponsor account to sponsor this network fee on behalf of biometric users.

### User Fund Security
The relayer is **strictly non-custodial**:
- The relayer keypair signs **only the outer fee envelope**.
- Moving user funds requires the smart wallet's contract invocation to pass `__check_auth`, which verifies the device's cryptographic WebAuthn assertion generated via Face ID/Touch ID.
- The relayer can never unilaterally move, redirect, or drain user funds.

### The `validateSponsorable` Invariant
Before co-signing any transaction submitted via `/v1/relayer/submit`, SlipPay validates the transaction against strict invariants:
1. **Outer Source**: The source account must match the configured sponsor public key.
2. **Fee Bound**: `tx.fee` cannot exceed `RELAYER_FEE_CAP` (default 2 XLM).
3. **Single Operation**: Exactly one operation of type `invokeHostFunction` is allowed.
4. **Permitted Function Calls**:
   - **Wallet Deploy**: Deploying a contract with the exact expected WASM hash (`RELAYER_WASM_HASH`).
   - **Contract Transfer**: Invoking `transfer` on a Stellar Asset Contract where the `from` parameter is confirmed to be a contract address (`scAddressTypeContract`), with amount strictly bounded by `RELAYER_AMOUNT_CAP` (default 0.5 XLM demo bound).

---

## Endpoints

### 1. `GET /api/v1/relayer/info`
Fetches public relayer parameters needed by the client to construct sponsored transactions.

**Response (200 OK):**
```json
{
  "sponsor": "GASP...SponsorPublicKey",
  "network": "TESTNET",
  "rpc": "https://soroban-testnet.stellar.org",
  "wasm_hash": "a1b2c3d4...",
  "amount_cap": "5000000"
}
```

---

### 2. `POST /api/v1/relayer/deploy`
Deploys a new passkey smart-wallet on Soroban bound to the user's device credential, and seeds it with a small startup float.

**Request Body:**
```json
{
  "passkey_pubkey_hex": "04a1b2...",
  "cred_id_hex": "e8f9..."
}
```

**Response (200 OK):**
```json
{
  "wallet_id": "CA3D...SmartWalletAddress",
  "funded": "2000000"
}
```

---

### 3. `POST /api/v1/relayer/submit`
Submits an assembled and passkey-authorized transaction XDR to be sponsored, signed by the relayer, and dispatched to the network.

**Request Body:**
```json
{
  "tx_xdr": "AAAAAgAAAA..."
}
```

**Response (200 OK):**
```json
{
  "ok": true,
  "hash": "8f3e...b4a1"
}
```
*(Fails with `400 Bad Request` if `validateSponsorable` rejects the XDR.)*
