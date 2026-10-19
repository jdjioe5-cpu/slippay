<?php
/**
 * SlipPay webhook receiver.
 * Listens at /wc-api/wc_slippay (registered automatically by WC's API
 * dispatcher when the woocommerce_api_<id> action fires). Verifies HMAC
 * if a webhook_secret is configured, then marks the matching WC order
 * as paid (or underpaid / cancelled / expired).
 *
 * @package WooCommerce_Slippay
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class WC_Slippay_Webhook {

    public function __construct() {
        add_action( 'woocommerce_api_wc_slippay', [ $this, 'handle' ] );
    }

    public function handle() {
        $raw = file_get_contents( 'php://input' );
        if ( ! $raw ) {
            status_header( 400 );
            echo wp_json_encode( [ 'error' => 'empty body' ] );
            exit;
        }

        $gateway = $this->get_gateway();
        $secret  = $gateway ? (string) $gateway->get_option( 'webhook_secret' ) : '';

        // Webhook secret is mandatory. Empty config is treated as misconfiguration,
        // not as "skip verification" — closing the auth-bypass vector from audit-001.
        if ( strlen( $secret ) < 32 ) {
            status_header( 503 );
            echo wp_json_encode( [ 'error' => 'webhook_not_configured' ] );
            exit;
        }

        $sig         = $this->get_signature_header();
        $delivery_id = isset( $_SERVER['HTTP_X_SLIPPAY_DELIVERY_ID'] )
            ? sanitize_text_field( $_SERVER['HTTP_X_SLIPPAY_DELIVERY_ID'] )
            : '';

        $check = $this->verify_and_check_replay( $raw, $sig, $delivery_id, $secret );
        if ( ! $check['ok'] ) {
            status_header( $check['code'] );
            echo wp_json_encode( [ 'error' => $check['error'] ] );
            exit;
        }

        $payload = json_decode( $raw, true );
        if ( ! is_array( $payload ) || empty( $payload['type'] ) || empty( $payload['data']['id'] ) ) {
            status_header( 400 );
            echo wp_json_encode( [ 'error' => 'malformed payload' ] );
            exit;
        }

        $slippay_order_id = sanitize_text_field( $payload['data']['id'] );
        $type             = sanitize_key( $payload['type'] );
        $tx_hash          = isset( $payload['data']['tx_hash'] ) ? sanitize_text_field( $payload['data']['tx_hash'] ) : '';

        $wc_order = $this->find_order_by_slippay_id( $slippay_order_id );
        if ( ! $wc_order ) {
            status_header( 404 );
            echo wp_json_encode( [ 'error' => 'wc order not found', 'slippay_id' => $slippay_order_id ] );
            exit;
        }

        // Audit-006 W3: every value interpolated into add_order_note /
        // update_status notes is wrapped in esc_html. WC renders notes as
        // HTML in admin; a compromised api_base / payload field could
        // inject markup otherwise.
        switch ( $type ) {
            case 'order.paid':
            case 'subscription.charged':
                if ( $tx_hash ) {
                    $wc_order->update_meta_data( '_slippay_tx_hash', $tx_hash );
                }
                $wc_order->payment_complete( $tx_hash );
                $wc_order->add_order_note( sprintf(
                    'SlipPay %s confirmed. tx: %s',
                    esc_html( $type ),
                    esc_html( $tx_hash ?: 'n/a' )
                ) );
                break;

            case 'order.underpaid':
                $expected = isset( $payload['data']['expected'] ) ? (string) $payload['data']['expected'] : '?';
                $received = isset( $payload['data']['received'] ) ? (string) $payload['data']['received'] : '?';
                $wc_order->update_status( 'on-hold', sprintf(
                    'SlipPay underpayment. expected %s, received %s',
                    esc_html( $expected ),
                    esc_html( $received )
                ) );
                break;

            case 'order.expired':
                $wc_order->update_status( 'cancelled', 'SlipPay order expired before payment.' );
                break;

            case 'order.cancelled':
                $wc_order->update_status( 'cancelled', 'SlipPay order cancelled.' );
                break;

            default:
                $wc_order->add_order_note( 'SlipPay event received (no-op for this type): ' . esc_html( $type ) );
                break;
        }

        $wc_order->save();
        status_header( 200 );
        echo wp_json_encode( [ 'ok' => true ] );
        exit;
    }

    private function get_signature_header() {
        // SlipPay convention: X-Slippay-Signature
        if ( isset( $_SERVER['HTTP_X_SLIPPAY_SIGNATURE'] ) ) {
            return sanitize_text_field( $_SERVER['HTTP_X_SLIPPAY_SIGNATURE'] );
        }
        if ( isset( $_SERVER['HTTP_X_SIGNATURE'] ) ) {
            return sanitize_text_field( $_SERVER['HTTP_X_SIGNATURE'] );
        }
        return '';
    }

    private function find_order_by_slippay_id( $slippay_order_id ) {
        $orders = wc_get_orders( [
            'limit'      => 1,
            'meta_key'   => '_slippay_order_id',
            'meta_value' => $slippay_order_id,
        ] );
        // Numeric-id fallback removed (audit-001): it converted the metadata-bound
        // lookup into a guessable integer probe of WC orders. Require the
        // _slippay_order_id meta to be set by the gateway at order creation time.
        return empty( $orders ) ? null : $orders[0];
    }

    private function get_gateway() {
        $gateways = WC()->payment_gateways()->payment_gateways();
        return isset( $gateways['slippay'] ) ? $gateways['slippay'] : null;
    }

    /**
     * Verify webhook signature and apply replay protections.
     *
     * Receiver Contract & Security Parameters:
     * - Authentication: HMAC-SHA256(secret, "$t.$raw") checked with constant-time hash_equals.
     * - Freshness window: 300 seconds (5 minutes). Rejects deliveries where |time() - $t| > 300.
     * - Mandatory Delivery ID: HTTP_X_SLIPPAY_DELIVERY_ID must be present. Missing ID returns 400.
     * - Replay deduplication window: 24 hours (DAY_IN_SECONDS / 86400s). Deduplicated on both
     *   the delivery ID and the signature hash ($v1) so a replayed payload cannot bypass the
     *   guard even if the delivery ID is omitted, altered, or re-generated. Duplicates within 24h return 409 Conflict.
     *
     * @param string $raw Raw request body.
     * @param string $sig Signature header value (t=<unix>,v1=<hex>).
     * @param string $delivery_id Delivery id header value.
     * @param string $secret Webhook secret.
     * @return array [ 'ok' => bool, 'code' => int, 'error' => string|null ]
     */
    public function verify_and_check_replay( $raw, $sig, $delivery_id, $secret ) {
        if ( empty( $sig ) ) {
            return [ 'ok' => false, 'code' => 401, 'error' => 'missing signature header' ];
        }

        if ( ! preg_match( '/^t=(\d+),v1=([a-f0-9]{64})$/', $sig, $m ) ) {
            return [ 'ok' => false, 'code' => 401, 'error' => 'malformed signature' ];
        }
        $t  = (int) $m[1];
        $v1 = $m[2];

        // Freshness window: 300 seconds (5 minutes)
        if ( abs( time() - $t ) > 300 ) {
            return [ 'ok' => false, 'code' => 401, 'error' => 'stale signature' ];
        }

        $expected = hash_hmac( 'sha256', $t . '.' . $raw, $secret );
        if ( ! hash_equals( $expected, $v1 ) ) {
            return [ 'ok' => false, 'code' => 401, 'error' => 'invalid signature' ];
        }

        // Replay protection: delivery ID is mandatory (apps/listener/src/webhook.ts:58).
        if ( empty( $delivery_id ) ) {
            return [ 'ok' => false, 'code' => 400, 'error' => 'missing delivery id' ];
        }

        // Deduplication window: 24 hours (DAY_IN_SECONDS).
        // Keyed on both delivery ID and signature hash ($v1) so replayed payload cannot bypass guard.
        $seen_delivery_key = 'slippay_seen_' . md5( $delivery_id );
        $seen_sig_key      = 'slippay_sig_' . md5( $v1 );

        if ( get_transient( $seen_delivery_key ) || get_transient( $seen_sig_key ) ) {
            return [ 'ok' => false, 'code' => 409, 'error' => 'duplicate delivery' ];
        }

        $ttl = defined( 'DAY_IN_SECONDS' ) ? DAY_IN_SECONDS : 86400;
        set_transient( $seen_delivery_key, 1, $ttl );
        set_transient( $seen_sig_key, 1, $ttl );

        return [ 'ok' => true, 'code' => 200, 'error' => null ];
    }
}
