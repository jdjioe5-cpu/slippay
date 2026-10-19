<?php
/**
 * Standalone test runner for SlipPay WooCommerce plugin.
 * Executes gateway and webhook test suites with zero external dependencies.
 */

// Enable assertions and bail on failure
ini_set( 'assert.active', 1 );
ini_set( 'assert.bail', 1 );

require_once __DIR__ . '/stubs.php';
require_once __DIR__ . '/../includes/class-wc-slippay-gateway.php';
require_once __DIR__ . '/../includes/class-wc-slippay-webhook.php';

require_once __DIR__ . '/test-webhook.php';
require_once __DIR__ . '/test-gateway.php';

echo "======================================================\n";
echo "  SlipPay WooCommerce Plugin PHP Test Harness (#476)  \n";
echo "======================================================\n";

$start_time = microtime( true );
$assert_count = 0;

try {
    run_webhook_tests( $assert_count );
    run_gateway_tests( $assert_count );

    $duration = round( ( microtime( true ) - $start_time ) * 1000, 2 );

    echo "\n======================================================\n";
    echo "  ✔ ALL TESTS PASSED CLEANLY ({$assert_count} assertions verified in {$duration}ms) \n";
    echo "======================================================\n";
    exit( 0 );
} catch ( Throwable $t ) {
    echo "\n❌ TEST FAILURE: " . $t->getMessage() . "\n";
    echo "Trace:\n" . $t->getTraceAsString() . "\n";
    exit( 1 );
}
