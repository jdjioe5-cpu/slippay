<?php
/**
 * Lightweight in-memory WordPress & WooCommerce stubs for unit testing.
 * Provides isolated simulation without WordPress runtime or database.
 */

if ( ! defined( 'ABSPATH' ) ) {
    define( 'ABSPATH', __DIR__ . '/../' );
}
if ( ! defined( 'DAY_IN_SECONDS' ) ) {
    define( 'DAY_IN_SECONDS', 86400 );
}
if ( ! defined( 'WC_SLIPPAY_TESTING' ) ) {
    define( 'WC_SLIPPAY_TESTING', true );
}
if ( ! defined( 'WC_SLIPPAY_VERSION' ) ) {
    define( 'WC_SLIPPAY_VERSION', '0.2.0' );
}
if ( ! defined( 'WC_SLIPPAY_PLUGIN_FILE' ) ) {
    define( 'WC_SLIPPAY_PLUGIN_FILE', dirname( __DIR__ ) . '/woocommerce-slippay.php' );
}
if ( ! defined( 'WC_SLIPPAY_PLUGIN_DIR' ) ) {
    define( 'WC_SLIPPAY_PLUGIN_DIR', dirname( __DIR__ ) . '/' );
}

// Global state stores
$GLOBALS['wp_filters']           = [];
$GLOBALS['wp_actions']           = [];
$GLOBALS['wp_transients']         = [];
$GLOBALS['wp_last_status_header'] = 200;
$GLOBALS['wp_last_output']        = '';
$GLOBALS['wc_notices']           = [];
$GLOBALS['wc_orders_store']      = [];
$GLOBALS['wc_current_currency']  = 'BRL';
$GLOBALS['wp_remote_post_mock']  = null;

function reset_test_environment() {
    $GLOBALS['wp_filters']           = [];
    $GLOBALS['wp_actions']           = [];
    $GLOBALS['wp_transients']         = [];
    $GLOBALS['wp_last_status_header'] = 200;
    $GLOBALS['wp_last_output']        = '';
    $GLOBALS['wc_notices']           = [];
    $GLOBALS['wc_orders_store']      = [];
    $GLOBALS['wc_current_currency']  = 'BRL';
    $GLOBALS['wp_remote_post_mock']  = null;
    $_SERVER['HTTP_X_SLIPPAY_SIGNATURE']   = null;
    $_SERVER['HTTP_X_SIGNATURE']           = null;
    $_SERVER['HTTP_X_SLIPPAY_DELIVERY_ID'] = null;
}

// ── WordPress Action & Filter Hooks ──
function add_action( $tag, $callback, $priority = 10, $accepted_args = 1 ) {
    $GLOBALS['wp_actions'][$tag][] = $callback;
}
function do_action( $tag, ...$args ) {
    if ( isset( $GLOBALS['wp_actions'][$tag] ) ) {
        foreach ( $GLOBALS['wp_actions'][$tag] as $cb ) {
            call_user_func_array( $cb, $args );
        }
    }
}
function add_filter( $tag, $callback, $priority = 10, $accepted_args = 1 ) {
    $GLOBALS['wp_filters'][$tag][] = $callback;
}
function apply_filters( $tag, $value, ...$args ) {
    if ( isset( $GLOBALS['wp_filters'][$tag] ) ) {
        foreach ( $GLOBALS['wp_filters'][$tag] as $cb ) {
            $value = call_user_func_array( $cb, array_merge( [ $value ], $args ) );
        }
    }
    return $value;
}

// ── WordPress Localization & Sanitation ──
function __( $text, $domain = 'default' ) { return $text; }
function esc_html__( $text, $domain = 'default' ) { return $text; }
function esc_html( $text ) { return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8' ); }
function esc_url( $url ) { return filter_var( $url, FILTER_SANITIZE_URL ); }
function sanitize_text_field( $str ) { return trim( strip_tags( (string) $str ) ); }
function sanitize_key( $key ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $key ) ); }

// ── WordPress Helpers ──
function plugin_dir_path( $file ) { return rtrim( dirname( $file ), '/\\' ) . '/'; }
function plugin_basename( $file ) { return basename( dirname( $file ) ) . '/' . basename( $file ); }
function plugins_url( $path = '', $plugin = '' ) { return 'https://example.com/wp-content/plugins/' . ltrim( $path, '/' ); }
function admin_url( $path = '' ) { return 'https://example.com/wp-admin/' . ltrim( $path, '/' ); }
function trailingslashit( $string ) { return rtrim( $string, '/\\' ) . '/'; }
function wp_parse_url( $url ) { return parse_url( $url ); }
function wp_json_encode( $data ) { return json_encode( $data ); }

function status_header( $code ) {
    $GLOBALS['wp_last_status_header'] = (int) $code;
}

// ── Transients API ──
function get_transient( $transient ) {
    return isset( $GLOBALS['wp_transients'][$transient] ) ? $GLOBALS['wp_transients'][$transient] : false;
}
function set_transient( $transient, $value, $expiration = 0 ) {
    $GLOBALS['wp_transients'][$transient] = $value;
    return true;
}
function delete_transient( $transient ) {
    unset( $GLOBALS['wp_transients'][$transient] );
    return true;
}

// ── HTTP API ──
function wp_remote_post( $url, $args = [] ) {
    if ( is_callable( $GLOBALS['wp_remote_post_mock'] ) ) {
        return call_user_func( $GLOBALS['wp_remote_post_mock'], $url, $args );
    }
    return [ 'response' => [ 'code' => 500 ], 'body' => json_encode( [ 'error' => 'no_mock_provided' ] ) ];
}
function wp_remote_retrieve_response_code( $response ) {
    return isset( $response['response']['code'] ) ? (int) $response['response']['code'] : 0;
}
function wp_remote_retrieve_body( $response ) {
    return isset( $response['body'] ) ? $response['body'] : '';
}
function is_wp_error( $thing ) {
    return is_a( $thing, 'WP_Error' );
}

class WP_Error {
    public $code;
    public $message;
    public function __construct( $code = '', $message = '' ) {
        $this->code = $code;
        $this->message = $message;
    }
    public function get_error_message() { return $this->message; }
    public function get_error_code() { return $this->code; }
}

// ── WooCommerce Stubs ──
function wc_add_notice( $message, $notice_type = 'success' ) {
    $GLOBALS['wc_notices'][] = [ 'type' => $notice_type, 'message' => $message ];
}
function get_woocommerce_currency() {
    return $GLOBALS['wc_current_currency'];
}

class WC_Order {
    public $id;
    public $total = '100.00';
    public $status = 'pending';
    public $meta = [];
    public $notes = [];
    public $payment_completed = false;

    public function __construct( $id = 123 ) {
        $this->id = $id;
    }
    public function get_id() { return $this->id; }
    public function get_total() { return $this->total; }
    public function update_meta_data( $key, $value ) { $this->meta[$key] = $value; }
    public function get_meta( $key ) { return isset( $this->meta[$key] ) ? $this->meta[$key] : ''; }
    public function add_order_note( $note ) { $this->notes[] = $note; }
    public function update_status( $status, $note = '' ) {
        $this->status = $status;
        if ( $note ) { $this->notes[] = $note; }
    }
    public function payment_complete( $tx_id = '' ) {
        $this->payment_completed = true;
        $this->status = 'processing';
    }
    public function save() {
        $GLOBALS['wc_orders_store'][$this->id] = $this;
    }
}

function wc_get_order( $id ) {
    return isset( $GLOBALS['wc_orders_store'][$id] ) ? $GLOBALS['wc_orders_store'][$id] : new WC_Order( $id );
}

function wc_get_orders( $args = [] ) {
    $results = [];
    if ( isset( $args['meta_key'] ) && isset( $args['meta_value'] ) ) {
        foreach ( $GLOBALS['wc_orders_store'] as $order ) {
            if ( isset( $order->meta[$args['meta_key']] ) && $order->meta[$args['meta_key']] === $args['meta_value'] ) {
                $results[] = $order;
            }
        }
    }
    return $results;
}

class WC_Cart {
    public $total = 100.00;
}

class WC_Payment_Gateways {
    public $gateways = [];
    public function payment_gateways() {
        return $this->gateways;
    }
}

class WooCommerce_Mock {
    public $cart;
    private $payment_gateways;

    public function __construct() {
        $this->cart = new WC_Cart();
        $this->payment_gateways = new WC_Payment_Gateways();
    }
    public function payment_gateways() {
        return $this->payment_gateways;
    }
}

function WC() {
    static $wc = null;
    if ( null === $wc ) {
        $wc = new WooCommerce_Mock();
    }
    return $wc;
}

class WC_Payment_Gateway {
    public $id = '';
    public $enabled = 'no';
    public $title = '';
    public $description = '';
    public $settings = [];
    public $form_fields = [];

    public function init_form_fields() {}
    public function init_settings() {}
    public function get_option( $key, $empty_value = null ) {
        return isset( $this->settings[$key] ) ? $this->settings[$key] : $empty_value;
    }
    public function is_available() {
        return 'yes' === $this->enabled;
    }
}
