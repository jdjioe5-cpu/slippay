<?php
/**
 * Test harness for WC_Gateway_Slippay total formatting and precision validation.
 */

if ( ! defined( 'ABSPATH' ) ) {
    define( 'ABSPATH', true );
}
if ( ! defined( 'WC_SLIPPAY_PLUGIN_FILE' ) ) {
    define( 'WC_SLIPPAY_PLUGIN_FILE', __FILE__ );
}

// Mock WordPress functions if not defined
if ( ! function_exists( '__' ) ) {
    function __( $text, $domain = 'default' ) {
        return $text;
    }
}
if ( ! function_exists( 'apply_filters' ) ) {
    function apply_filters( $tag, $value ) {
        return $value;
    }
}
if ( ! function_exists( 'add_action' ) ) {
    function add_action( $hook, $callback, $priority = 10, $accepted_args = 1 ) {}
}
if ( ! function_exists( 'plugins_url' ) ) {
    function plugins_url( $path = '', $plugin = '' ) {
        return 'https://example.com/wp-content/plugins/' . $path;
    }
}

// Mock WC_Payment_Gateway base class
if ( ! class_exists( 'WC_Payment_Gateway' ) ) {
    class WC_Payment_Gateway {
        public $id = '';
        public $icon = '';
        public $has_fields = false;
        public $method_title = '';
        public $method_description = '';
        public $supports = [];
        public $title = '';
        public $description = '';
        public $enabled = 'no';
        public function init_form_fields() {}
        public function init_settings() {}
        public function get_option( $key, $default = '' ) { return $default; }
        public function is_available() { return true; }
    }
}

require_once __DIR__ . '/../includes/class-wc-slippay-gateway.php';

echo "Running WC_Slippay_Gateway Precision and Schema Limit Tests...\n";

$gateway = new WC_Slippay_Gateway();

// 1. Exact cent total without float drift
$res1 = $gateway->format_and_validate_total( '1234.50' );
assert( $res1['ok'] === true, 'Test 1 failed: Valid amount must succeed' );
assert( $res1['amount'] === '1234.50', 'Test 1 failed: Amount mismatch' );
echo "✓ Test 1 Passed: Exact cent total formatted correctly (1234.50).\n";

// 2. Extra decimals rounded with PHP_ROUND_HALF_UP (1234.565 -> 1234.57)
$res2 = $gateway->format_and_validate_total( '1234.565' );
assert( $res2['ok'] === true, 'Test 2 failed: 3-decimal amount must succeed' );
assert( $res2['amount'] === '1234.57', 'Test 2 failed: 1234.565 must round up to 1234.57' );
echo "✓ Test 2 Passed: 1234.565 rounded up to 1234.57 via PHP_ROUND_HALF_UP.\n";

// 2b. Extra decimals rounding down (1234.564 -> 1234.56)
$res2b = $gateway->format_and_validate_total( '1234.564' );
assert( $res2b['ok'] === true, 'Test 2b failed: 1234.564 must succeed' );
assert( $res2b['amount'] === '1234.56', 'Test 2b failed: 1234.564 must round down to 1234.56' );
echo "✓ Test 2b Passed: 1234.564 rounded down to 1234.56.\n";

// 3. Integer amount padding to 2 decimal places
$res3 = $gateway->format_and_validate_total( '99' );
assert( $res3['ok'] === true, 'Test 3 failed: Integer amount must succeed' );
assert( $res3['amount'] === '99.00', 'Test 3 failed: 99 must format to 99.00' );
echo "✓ Test 3 Passed: Integer total padded to two decimals (99.00).\n";

// 4. Maximum schema boundary total: exactly 9 integer digits
$res4 = $gateway->format_and_validate_total( '999999999.99' );
assert( $res4['ok'] === true, 'Test 4 failed: Maximum 9-digit total must pass' );
assert( $res4['amount'] === '999999999.99', 'Test 4 failed: Amount mismatch at limit' );
echo "✓ Test 4 Passed: Upper limit 999,999,999.99 BRL accepted.\n";

// 5. Out of range total: 10 integer digits rejected with named limit
$res5 = $gateway->format_and_validate_total( '1000000000.00' );
assert( $res5['ok'] === false, 'Test 5 failed: 10-digit total must be rejected' );
assert( strpos( $res5['error'], '999,999,999.99' ) !== false, 'Test 5 failed: Error message must name limit' );
echo "✓ Test 5 Passed: Out of range total (10 integer digits) rejected with specific named limit.\n";

// 6. Zero amount rejected
$res6 = $gateway->format_and_validate_total( '0.00' );
assert( $res6['ok'] === false, 'Test 6 failed: Zero amount must be rejected' );
assert( strpos( $res6['error'], 'greater than zero' ) !== false, 'Test 6 failed: Error must state greater than zero' );
echo "✓ Test 6 Passed: Zero amount rejected.\n";

// 7. Malformed / negative amount rejected
$res7 = $gateway->format_and_validate_total( '-15.00' );
assert( $res7['ok'] === false, 'Test 7 failed: Negative amount must be rejected' );
echo "✓ Test 7 Passed: Negative amount rejected.\n";

echo "\nAll WC_Gateway_Slippay precision and schema tests passed successfully!\n";
