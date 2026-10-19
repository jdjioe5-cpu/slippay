<?php
/**
 * Test suite covering WC_Slippay_Gateway process_payment security guards & is_available conditions.
 */

function run_gateway_tests( &$assert_count ) {
    echo "\n--- Running Gateway Security & Availability Tests ---\n";

    $mock_live_key = 'sk_' . 'live_mock_key_000000000000';
    $mock_test_key = 'sk_' . 'test_mock_key_000000000000';

    // 1. Missing API key in process_payment
    reset_test_environment();
    $gw = new WC_Slippay_Gateway();
    $gw->api_key = '';
    $order = new WC_Order( 101 );
    $order->save();
    $res = $gw->process_payment( 101 );
    assert( $res['result'] === 'fail', "Process payment must fail when api_key is missing" );
    $assert_count++;
    echo "  ✔ Missing API key fails process_payment\n";

    // 2. Mismatched key prefix: testnet environment with sk_live_ key
    reset_test_environment();
    $gw = new WC_Slippay_Gateway();
    $gw->api_key = $mock_live_key;
    $gw->environment = 'testnet';
    $gw->api_base = 'https://api.slippay.cc';
    $order = new WC_Order( 102 );
    $order->save();
    $res = $gw->process_payment( 102 );
    assert( $res['result'] === 'fail', "Process payment must fail when key prefix is live in testnet" );
    $assert_count++;
    echo "  ✔ Live key prefix in testnet environment fails process_payment\n";

    // 3. Mismatched key prefix: mainnet environment with sk_test_ key
    reset_test_environment();
    $gw = new WC_Slippay_Gateway();
    $gw->api_key = $mock_test_key;
    $gw->environment = 'mainnet';
    $gw->api_base = 'https://api.slippay.cc';
    $order = new WC_Order( 103 );
    $order->save();
    $res = $gw->process_payment( 103 );
    assert( $res['result'] === 'fail', "Process payment must fail when key prefix is test in mainnet" );
    $assert_count++;
    echo "  ✔ Test key prefix in mainnet environment fails process_payment\n";

    // 4. Disallowed api_base host
    reset_test_environment();
    $gw = new WC_Slippay_Gateway();
    $gw->api_key = $mock_test_key;
    $gw->environment = 'testnet';
    $gw->api_base = 'https://malicious-external-api.com';
    $order = new WC_Order( 104 );
    $order->save();
    $res = $gw->process_payment( 104 );
    assert( $res['result'] === 'fail', "Process payment must fail when api_base is not in allowlist" );
    $assert_count++;
    echo "  ✔ Disallowed api_base rejected by allowlist\n";

    // 5. Insecure HTTP api_base (must be https)
    reset_test_environment();
    $gw = new WC_Slippay_Gateway();
    $gw->api_key = $mock_test_key;
    $gw->environment = 'testnet';
    $gw->api_base = 'http://api.slippay.cc';
    $order = new WC_Order( 105 );
    $order->save();
    $res = $gw->process_payment( 105 );
    assert( $res['result'] === 'fail', "Process payment must fail for non-https api_base" );
    $assert_count++;
    echo "  ✔ Insecure HTTP api_base rejected by allowlist\n";

    // 6. Unsafe checkout_url redirect host
    reset_test_environment();
    $gw = new WC_Slippay_Gateway();
    $gw->api_key = $mock_test_key;
    $gw->environment = 'testnet';
    $gw->api_base = 'https://api.slippay.cc';

    // Mock remote post to return phishing redirect
    $GLOBALS['wp_remote_post_mock'] = function( $url, $args ) {
        return [
            'response' => [ 'code' => 201 ],
            'body' => json_encode( [
                'order' => [ 'id' => 'ord_1', 'memo' => 'memo1', 'usdc_amount' => '10.00' ],
                'checkout_url' => 'https://phishing-site.com/checkout/ord_1',
            ] ),
        ];
    };
    $order = new WC_Order( 106 );
    $order->save();
    $res = $gw->process_payment( 106 );
    assert( $res['result'] === 'fail', "Process payment must fail when checkout_url host is untrusted" );
    $assert_count++;
    echo "  ✔ Untrusted checkout_url redirect host rejected\n";

    // 7. Valid process_payment flow
    reset_test_environment();
    $gw = new WC_Slippay_Gateway();
    $gw->api_key = $mock_test_key;
    $gw->environment = 'testnet';
    $gw->api_base = 'https://api.slippay.cc';

    $GLOBALS['wp_remote_post_mock'] = function( $url, $args ) {
        return [
            'response' => [ 'code' => 201 ],
            'body' => json_encode( [
                'order' => [ 'id' => 'ord_safe_999', 'memo' => 'mem_safe_999', 'usdc_amount' => '20.00' ],
                'checkout_url' => 'https://pay.slippay.cc/checkout/ord_safe_999',
            ] ),
        ];
    };
    $order = new WC_Order( 107 );
    $order->total = '110.50';
    $order->save();
    $res = $gw->process_payment( 107 );
    assert( $res['result'] === 'success', "Valid process_payment should succeed" );
    assert( $res['redirect'] === 'https://pay.slippay.cc/checkout/ord_safe_999', "Redirect URL must match checkout_url" );
    assert( $order->meta['_slippay_order_id'] === 'ord_safe_999', "Order must have _slippay_order_id stored" );
    assert( $order->status === 'pending', "Order status should be updated to pending" );
    $assert_count += 4;
    echo "  ✔ Valid process_payment initiates order and sets metadata\n";

    // 8. Gateway is_available: Currency Gate (BRL required)
    reset_test_environment();
    $gw = new WC_Slippay_Gateway();
    $gw->enabled = 'yes';
    $gw->api_key = $mock_test_key;
    WC()->cart->total = 50.0;

    $GLOBALS['wc_current_currency'] = 'USD';
    assert( $gw->is_available() === false, "Gateway must be unavailable when currency is USD" );
    $GLOBALS['wc_current_currency'] = 'EUR';
    assert( $gw->is_available() === false, "Gateway must be unavailable when currency is EUR" );
    $GLOBALS['wc_current_currency'] = 'BRL';
    assert( $gw->is_available() === true, "Gateway must be available when currency is BRL" );
    $assert_count += 3;
    echo "  ✔ Currency gate enforces BRL-only availability\n";

    // 9. Gateway is_available: Zero-total cart
    reset_test_environment();
    $gw = new WC_Slippay_Gateway();
    $gw->enabled = 'yes';
    $gw->api_key = $mock_test_key;
    $GLOBALS['wc_current_currency'] = 'BRL';

    WC()->cart->total = 0.0;
    assert( $gw->is_available() === false, "Gateway must be unavailable for zero-total cart" );
    WC()->cart->total = -1.0;
    assert( $gw->is_available() === false, "Gateway must be unavailable for negative-total cart" );
    WC()->cart->total = 10.0;
    assert( $gw->is_available() === true, "Gateway must be available for positive-total cart" );
    $assert_count += 3;
    echo "  ✔ Cart total gate hides gateway on zero or negative cart total\n";

    // 10. Gateway is_available: Disabled or empty key
    reset_test_environment();
    $gw = new WC_Slippay_Gateway();
    $gw->enabled = 'no';
    $gw->api_key = $mock_test_key;
    $GLOBALS['wc_current_currency'] = 'BRL';
    WC()->cart->total = 10.0;
    assert( $gw->is_available() === false, "Gateway must be unavailable when enabled=no" );

    $gw->enabled = 'yes';
    $gw->api_key = '';
    assert( $gw->is_available() === false, "Gateway must be unavailable when api_key is empty" );
    $assert_count += 2;
    echo "  ✔ Disabled status and empty API key correctly hide gateway\n";
}
