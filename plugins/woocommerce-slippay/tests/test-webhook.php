<?php
/**
 * Test suite covering the WC_Slippay_Webhook verification chain and event dispatching.
 */

function run_webhook_tests( &$assert_count ) {
    $secret = "test-webhook-secret-at-least-32-chars-long!!";

    $setup_gateway = function( $webhook_secret ) {
        $gw = new WC_Slippay_Gateway();
        $gw->settings['webhook_secret'] = $webhook_secret;
        WC()->payment_gateways()->gateways['slippay'] = $gw;
        return $gw;
    };

    // Helper to invoke webhook and capture output & status code
    $call_webhook = function( $raw_body = null, $headers = [] ) {
        if ( null !== $raw_body ) {
            add_filter( 'wc_slippay_webhook_raw_input', function() use ( $raw_body ) {
                return $raw_body;
            } );
        }

        foreach ( $headers as $k => $v ) {
            $_SERVER[$k] = $v;
        }

        ob_start();
        $webhook = new WC_Slippay_Webhook();
        $webhook->handle();
        $output = ob_get_clean();

        $code = $GLOBALS['wp_last_status_header'];
        $data = json_decode( $output, true );

        return [ 'code' => $code, 'data' => $data, 'raw_output' => $output ];
    };

    echo "\n--- Running Webhook Verification Chain Tests ---\n";

    // 1. Empty body
    reset_test_environment();
    $setup_gateway( $secret );
    $res = $call_webhook( "" );
    assert( $res['code'] === 400, "Empty body must return HTTP 400" );
    assert( $res['data']['error'] === 'empty body', "Error must state 'empty body'" );
    $assert_count += 2;
    echo "  ✔ Empty body rejected with 400\n";

    // 2. Webhook unconfigured / secret < 32 chars
    reset_test_environment();
    $setup_gateway( "short" );
    $res = $call_webhook( "some payload" );
    assert( $res['code'] === 503, "Unconfigured secret must return HTTP 503" );
    assert( $res['data']['error'] === 'webhook_not_configured', "Error must state 'webhook_not_configured'" );
    $assert_count += 2;
    echo "  ✔ Unconfigured / short secret rejected with 503\n";

    // 3. Missing signature header
    reset_test_environment();
    $setup_gateway( $secret );
    $res = $call_webhook( "some payload" );
    assert( $res['code'] === 401, "Missing signature header must return HTTP 401" );
    assert( $res['data']['error'] === 'missing signature header', "Error must state 'missing signature header'" );
    $assert_count += 2;
    echo "  ✔ Missing signature header rejected with 401\n";

    // 4. Malformed signature header
    reset_test_environment();
    $setup_gateway( $secret );
    $res = $call_webhook( "some payload", [ 'HTTP_X_SLIPPAY_SIGNATURE' => 'invalid-format' ] );
    assert( $res['code'] === 401, "Malformed signature must return HTTP 401" );
    assert( $res['data']['error'] === 'malformed signature', "Error must state 'malformed signature'" );
    $assert_count += 2;
    echo "  ✔ Malformed signature header rejected with 401\n";

    // 5. Stale signature header (> 300 seconds)
    reset_test_environment();
    $setup_gateway( $secret );
    $payload = '{"test":1}';
    $stale_time = time() - 301;
    $hmac = hash_hmac( 'sha256', $stale_time . '.' . $payload, $secret );
    $sig = "t={$stale_time},v1={$hmac}";
    $res = $call_webhook( $payload, [ 'HTTP_X_SLIPPAY_SIGNATURE' => $sig ] );
    assert( $res['code'] === 401, "Stale signature must return HTTP 401" );
    assert( $res['data']['error'] === 'stale signature', "Error must state 'stale signature'" );
    $assert_count += 2;
    echo "  ✔ Stale signature rejected with 401\n";

    // 6. Invalid HMAC signature
    reset_test_environment();
    $setup_gateway( $secret );
    $payload = '{"test":1}';
    $now = time();
    $bad_hmac = str_repeat( '0', 64 );
    $sig = "t={$now},v1={$bad_hmac}";
    $res = $call_webhook( $payload, [ 'HTTP_X_SLIPPAY_SIGNATURE' => $sig ] );
    assert( $res['code'] === 401, "Invalid signature must return HTTP 401" );
    assert( $res['data']['error'] === 'invalid signature', "Error must state 'invalid signature'" );
    $assert_count += 2;
    echo "  ✔ Invalid HMAC signature rejected with 401\n";

    // 7. Duplicate delivery (replay protection)
    reset_test_environment();
    $setup_gateway( $secret );
    $payload = '{"test":1}';
    $now = time();
    $hmac = hash_hmac( 'sha256', $now . '.' . $payload, $secret );
    $sig = "t={$now},v1={$hmac}";
    $delivery_id = "deliv_123456";

    // First delivery sets transient and fails on payload parsing
    $res1 = $call_webhook( $payload, [
        'HTTP_X_SLIPPAY_SIGNATURE' => $sig,
        'HTTP_X_SLIPPAY_DELIVERY_ID' => $delivery_id,
    ] );
    assert( $res1['code'] === 400, "First delivery should pass replay check and reach payload validation" );

    // Second delivery with same delivery_id must fail replay guard with 409
    $res2 = $call_webhook( $payload, [
        'HTTP_X_SLIPPAY_SIGNATURE' => $sig,
        'HTTP_X_SLIPPAY_DELIVERY_ID' => $delivery_id,
    ] );
    assert( $res2['code'] === 409, "Replayed delivery_id must return HTTP 409" );
    assert( $res2['data']['error'] === 'duplicate delivery', "Error must state 'duplicate delivery'" );
    $assert_count += 3;
    echo "  ✔ Replayed delivery_id rejected with 409\n";

    // 8. Malformed payload JSON or missing fields
    reset_test_environment();
    $setup_gateway( $secret );
    $payload = '{"invalid_json": ';
    $now = time();
    $hmac = hash_hmac( 'sha256', $now . '.' . $payload, $secret );
    $res = $call_webhook( $payload, [ 'HTTP_X_SLIPPAY_SIGNATURE' => "t={$now},v1={$hmac}" ] );
    assert( $res['code'] === 400, "Malformed json payload must return HTTP 400" );
    assert( $res['data']['error'] === 'malformed payload', "Error must state 'malformed payload'" );
    $assert_count += 2;
    echo "  ✔ Malformed payload JSON rejected with 400\n";

    // 9. WC order not found
    reset_test_environment();
    $setup_gateway( $secret );
    $payload = json_encode( [
        'type' => 'order.paid',
        'data' => [ 'id' => 'ord_nonexistent', 'tx_hash' => 'tx_abc' ],
    ] );
    $now = time();
    $hmac = hash_hmac( 'sha256', $now . '.' . $payload, $secret );
    $res = $call_webhook( $payload, [ 'HTTP_X_SLIPPAY_SIGNATURE' => "t={$now},v1={$hmac}" ] );
    assert( $res['code'] === 404, "Order not found must return HTTP 404" );
    assert( $res['data']['error'] === 'wc order not found', "Error must state 'wc order not found'" );
    $assert_count += 2;
    echo "  ✔ Non-existent order rejected with 404\n";

    // 10. Valid order.paid delivery
    reset_test_environment();
    $setup_gateway( $secret );
    $wc_order = new WC_Order( 501 );
    $wc_order->update_meta_data( '_slippay_order_id', 'ord_live_777' );
    $wc_order->save();

    $payload = json_encode( [
        'type' => 'order.paid',
        'data' => [ 'id' => 'ord_live_777', 'tx_hash' => 'stellar_tx_hash_123' ],
    ] );
    $now = time();
    $hmac = hash_hmac( 'sha256', $now . '.' . $payload, $secret );
    $res = $call_webhook( $payload, [ 'HTTP_X_SLIPPAY_SIGNATURE' => "t={$now},v1={$hmac}" ] );
    assert( $res['code'] === 200, "Valid delivery must return HTTP 200" );
    assert( $res['data']['ok'] === true, "Response must report ok: true" );
    $saved_order = wc_get_order( 501 );
    assert( $saved_order->payment_completed === true, "WC Order must be marked payment_completed" );
    assert( $saved_order->meta['_slippay_tx_hash'] === 'stellar_tx_hash_123', "TX hash must be stored in order meta" );
    $assert_count += 4;
    echo "  ✔ Valid order.paid completes payment and sets metadata\n";

    // 11. order.underpaid event
    reset_test_environment();
    $setup_gateway( $secret );
    $wc_order = new WC_Order( 502 );
    $wc_order->update_meta_data( '_slippay_order_id', 'ord_live_underpaid' );
    $wc_order->save();

    $payload = json_encode( [
        'type' => 'order.underpaid',
        'data' => [ 'id' => 'ord_live_underpaid', 'expected' => '50.00', 'received' => '25.00' ],
    ] );
    $now = time();
    $hmac = hash_hmac( 'sha256', $now . '.' . $payload, $secret );
    $res = $call_webhook( $payload, [ 'HTTP_X_SLIPPAY_SIGNATURE' => "t={$now},v1={$hmac}" ] );
    assert( $res['code'] === 200, "Underpaid event must return HTTP 200" );
    assert( $wc_order->status === 'on-hold', "Underpaid order must be set to on-hold status" );
    $assert_count += 2;
    echo "  ✔ Valid order.underpaid marks order on-hold\n";

    // 12. order.expired event
    reset_test_environment();
    $setup_gateway( $secret );
    $wc_order = new WC_Order( 503 );
    $wc_order->update_meta_data( '_slippay_order_id', 'ord_live_expired' );
    $wc_order->save();

    $payload = json_encode( [
        'type' => 'order.expired',
        'data' => [ 'id' => 'ord_live_expired' ],
    ] );
    $now = time();
    $hmac = hash_hmac( 'sha256', $now . '.' . $payload, $secret );
    $res = $call_webhook( $payload, [ 'HTTP_X_SLIPPAY_SIGNATURE' => "t={$now},v1={$hmac}" ] );
    assert( $res['code'] === 200, "Expired event must return HTTP 200" );
    assert( $wc_order->status === 'cancelled', "Expired order must be set to cancelled status" );
    $assert_count += 2;
    echo "  ✔ Valid order.expired marks order cancelled\n";
}
