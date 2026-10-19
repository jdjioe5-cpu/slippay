<?php
/**
 * Test harness for WC_Slippay_Webhook replay protection and signature verification.
 */

// Define WordPress mock functions & constants if not loaded
if ( ! defined( 'ABSPATH' ) ) {
    define( 'ABSPATH', true );
}
if ( ! defined( 'DAY_IN_SECONDS' ) ) {
    define( 'DAY_IN_SECONDS', 86400 );
}

$GLOBALS['transients'] = [];

if ( ! function_exists( 'get_transient' ) ) {
    function get_transient( $key ) {
        return isset( $GLOBALS['transients'][ $key ] ) ? $GLOBALS['transients'][ $key ] : false;
    }
}

if ( ! function_exists( 'set_transient' ) ) {
    function set_transient( $key, $value, $expiration ) {
        $GLOBALS['transients'][ $key ] = $value;
        return true;
    }
}

if ( ! function_exists( 'add_action' ) ) {
    function add_action( $hook, $callback ) {}
}

require_once __DIR__ . '/../includes/class-wc-slippay-webhook.php';

echo "Running WC_Slippay_Webhook Replay Guard & Signature Tests...\n";

$webhook = new WC_Slippay_Webhook();
$secret  = 'test_webhook_secret_key_at_least_32_characters_long_for_security';
$payload = json_encode( [
    'type' => 'order.paid',
    'data' => [ 'id' => 'ord_test_123', 'tx_hash' => '0xbeef' ],
] );

$now = time();
$sig = 't=' . $now . ',v1=' . hash_hmac( 'sha256', $now . '.' . $payload, $secret );
$delivery_id = 'dlv_unique_uuid_001';

// Test 1: Valid initial delivery passes
$res1 = $webhook->verify_and_check_replay( $payload, $sig, $delivery_id, $secret );
assert( $res1['ok'] === true, 'Test 1 failed: Initial valid delivery must pass' );
assert( $res1['code'] === 200, 'Test 1 failed: Code must be 200' );
echo "✓ Test 1 Passed: Valid initial delivery succeeds.\n";

// Test 2: Identical delivery replay with same delivery_id is rejected with 409 Conflict
$res2 = $webhook->verify_and_check_replay( $payload, $sig, $delivery_id, $secret );
assert( $res2['ok'] === false, 'Test 2 failed: Replay with same delivery_id must fail' );
assert( $res2['code'] === 409, 'Test 2 failed: Code must be 409' );
assert( $res2['error'] === 'duplicate delivery', 'Test 2 failed: Error must be duplicate delivery' );
echo "✓ Test 2 Passed: Replay with same delivery_id rejected with 409.\n";

// Test 3: Missing delivery ID is rejected with 400 Bad Request
$res3 = $webhook->verify_and_check_replay( $payload, $sig, '', $secret );
assert( $res3['ok'] === false, 'Test 3 failed: Missing delivery id must fail' );
assert( $res3['code'] === 400, 'Test 3 failed: Code must be 400' );
assert( $res3['error'] === 'missing delivery id', 'Test 3 failed: Error must be missing delivery id' );
echo "✓ Test 3 Passed: Missing delivery ID rejected with 400.\n";

// Test 4: Attacker uses a new delivery_id to replay the same payload/signature within 24h
// Signature hash ($v1) transient must catch and reject with 409 Conflict
$res4 = $webhook->verify_and_check_replay( $payload, $sig, 'dlv_attacker_new_id_002', $secret );
assert( $res4['ok'] === false, 'Test 4 failed: Replay with forged delivery ID must fail via signature dedup' );
assert( $res4['code'] === 409, 'Test 4 failed: Code must be 409' );
assert( $res4['error'] === 'duplicate delivery', 'Test 4 failed: Error must be duplicate delivery' );
echo "✓ Test 4 Passed: Replay of same payload with different delivery ID caught by signature hash dedup (409).\n";

// Test 5: Stale timestamp (> 300s) is rejected with 401
$stale_time = $now - 301;
$stale_sig  = 't=' . $stale_time . ',v1=' . hash_hmac( 'sha256', $stale_time . '.' . $payload, $secret );
$res5 = $webhook->verify_and_check_replay( $payload, $stale_sig, 'dlv_stale_003', $secret );
assert( $res5['ok'] === false, 'Test 5 failed: Stale signature must fail' );
assert( $res5['code'] === 401, 'Test 5 failed: Code must be 401' );
assert( $res5['error'] === 'stale signature', 'Test 5 failed: Error must be stale signature' );
echo "✓ Test 5 Passed: Stale signature (> 300s) rejected with 401.\n";

// Test 6: Invalid HMAC is rejected with 401
$bad_sig = 't=' . $now . ',v1=' . str_repeat('0', 64);
$res6 = $webhook->verify_and_check_replay( $payload, $bad_sig, 'dlv_badsig_004', $secret );
assert( $res6['ok'] === false, 'Test 6 failed: Invalid HMAC must fail' );
assert( $res6['code'] === 401, 'Test 6 failed: Code must be 401' );
assert( $res6['error'] === 'invalid signature', 'Test 6 failed: Error must be invalid signature' );
echo "✓ Test 6 Passed: Invalid HMAC signature rejected with 401.\n";

echo "\nAll WC_Slippay_Webhook replay and signature tests passed successfully!\n";
