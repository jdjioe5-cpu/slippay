# SlipPay for WooCommerce

Accept USDC and PYUSD payments on Stellar from any WooCommerce store. Buyers
pay in BRL via Pix or directly in stablecoin from a Stellar wallet; the
merchant receives USDC or PYUSD on a Stellar address they control. Six-second
finality, no chargebacks, non-custodial.

**Status**: v0.1.0 · works against `https://api.slippay.cc` (testnet by default)

---

## Install

### Via the WordPress admin

1. Download or clone this folder as `woocommerce-slippay/`.
2. Zip it (`zip -r woocommerce-slippay.zip woocommerce-slippay/`).
3. WordPress admin → Plugins → Add New → Upload Plugin → choose the zip → Install → Activate.

### Via SSH on the server

```sh
cd wp-content/plugins
git clone --depth 1 https://github.com/Galmanus/slippay.git slippay-tmp
mv slippay-tmp/plugins/woocommerce-slippay ./
rm -rf slippay-tmp
```

Then activate from WordPress admin.

---

## Configure

1. **Create a SlipPay merchant**
   Sign up at https://api.slippay.cc/signup. Drop your Stellar receive address
   in Settings. Copy the `sk_live_…` API key (shown once at creation; rotate
   from Settings if you lose it).

2. **WooCommerce → Settings → Payments → SlipPay**

   | field            | value                                                 |
   |------------------|-------------------------------------------------------|
   | Enable           | check                                                 |
   | Environment      | `testnet` for test runs; switch to `mainnet` when live |
   | API base URL     | `https://api.slippay.cc` (don't change unless self-host) |
   | API key          | `sk_live_…` from your dashboard                       |
   | Default asset    | USDC or PYUSD                                          |
   | Webhook secret   | mandatory string (>= 32 chars); must match what you configured on the SlipPay merchant side |

3. **Configure the webhook URL on SlipPay**
   In your SlipPay merchant dashboard, set webhook URL to:
   ```
   https://your-store.com/wc-api/wc_slippay
   ```
   Plugin verifies HMAC-SHA256 (`t=<unix>,v1=<hex>`) of the request body against your shared secret.

---

## What happens at checkout

1. Buyer picks SlipPay at checkout and clicks **Place Order**.
2. Plugin calls `POST /api/v1/orders` on SlipPay backend with the WC order
   total, generates a SlipPay order id, and stores it as order meta
   (`_slippay_order_id`).
3. WC redirects buyer to the SlipPay-hosted checkout
   (`/checkout/<order_id>`).
4. Buyer signs the payment in their Stellar wallet (Freighter, Lobstr, xBull,
   Albedo, Hana). Settlement is instant (~6 seconds).
5. SlipPay listener confirms the on-chain payment, fires
   `order.paid` webhook to `/wc-api/wc_slippay`.
6. Plugin verifies HMAC, calls `WC_Order::payment_complete( $tx_hash )`.
7. Order shows up as Completed in WC admin with the Stellar tx hash in the
   notes.

---

## Webhook events handled

| event                  | what the plugin does                                    |
|------------------------|---------------------------------------------------------|
| `order.paid`           | `payment_complete()`, store tx_hash on order meta       |
| `subscription.charged` | same as `order.paid` (recurring billing)                |
| `order.underpaid`      | `update_status('on-hold')` with expected/received note  |
| `order.expired`        | `update_status('cancelled')` with reason                |
| `order.cancelled`      | `update_status('cancelled')`                            |

---

## Compatibility & Verification

- **PHP**: PHP 7.4+
- **HPOS**: High-Performance Order Storage compatibility declared via `FeaturesUtil::declare_compatibility('custom_order_tables')` in `woocommerce-slippay.php`
- **WordPress & WooCommerce Target**: WordPress 6.0+ and WooCommerce 7.0+ through 9.x (runtime integration harness tracked in issue #164)

---

## Security

- Plugin never sees buyer's private key. Wallet flow happens on the SlipPay
  hosted checkout, not on your store.
- API key is stored encrypted at rest by WordPress (in `wp_options` per WC
  convention). For extra safety, rotate the key from your SlipPay dashboard
  if you suspect compromise; old key invalidates immediately.
- **Mandatory Webhook Secret**: Webhook verification is required and unconditional.
  A webhook secret of at least 32 characters (`strlen($secret) >= 32`) must be configured
  in WooCommerce settings. If empty or shorter than 32 characters, the handler rejects
  all requests with HTTP `503 webhook_not_configured` and refuses to mark orders as paid
  (closing the auth-bypass vector from audit-001).
- **HMAC Signature & Timing Drift**: Webhook requests must provide a valid signature
  header (`t=<unix>,v1=<hex>`). The plugin computes `hash_hmac('sha256', $t . '.' . $raw, $secret)`
  and compares it in constant time with `hash_equals`. Requests with timestamp drift
  exceeding 300 seconds (`abs(time() - $t) > 300`) are rejected with `401 stale signature`.
- **Replay Protection**: The listener provides a unique delivery ID in the `X-SlipPay-Delivery-Id`
  header. The plugin records this delivery ID in a 24-hour WordPress transient cache
  (`DAY_IN_SECONDS`) and rejects replayed deliveries with HTTP `409 duplicate delivery`.
- `wc_get_orders` lookup by `_slippay_order_id` is exact-match; no fuzzy
  resolution that could let a malicious payload mark the wrong order paid.

---

## Roadmap

- v0.2: optional buyer-side Pix-in flow (when SlipPay anchor partnership lands)
- v0.3: subscription products (link a WC Subscription to a SlipPay subscription)
- v0.4: refund support (manual merchant-initiated USDC return)
- v1.0: WooCommerce.com / WordPress.org plugin directory submission

---

## Support

- SlipPay backend: https://api.slippay.cc/api/health
- SlipPay docs: https://api.slippay.cc/ (landing) / https://api.slippay.cc/demo (SDK demo)
- Repo issues: https://github.com/Galmanus/slippay/issues

License: Apache-2.0.
