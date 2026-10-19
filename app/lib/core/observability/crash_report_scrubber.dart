import 'package:sentry_flutter/sentry_flutter.dart';

/// Scrubs PII, private keys, and transaction hashes before crash reports leave the device.
class CrashReportScrubber {
  const CrashReportScrubber._();

  static final RegExp _stellarSecretKeyRegex = RegExp(r'\bS[A-Z2-7]{55}\b');
  static final RegExp _stellarAddressRegex = RegExp(r'\b[GCM][A-Z2-7]{55}\b');
  static final RegExp _txHashRegex = RegExp(r'\b[0-9a-fA-F]{64}\b');
  static final RegExp _bearerTokenRegex =
      RegExp(r'\b(Bearer\s+)[A-Za-z0-9_\-\.]{10,}\b', caseSensitive: false);
  static final RegExp _authHeaderRegex =
      RegExp(r'(authorization:\s*)[^\s,]+', caseSensitive: false);
  static final RegExp _emailRegex =
      RegExp(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b');
  static final RegExp _cnpjRegex =
      RegExp(r'\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b');
  static final RegExp _cpfRegex =
      RegExp(r'\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b');
  static final RegExp _phoneRegex =
      RegExp(r'(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-\s]?\d{4}\b');

  /// Redacts sensitive strings (secrets, addresses, tx hashes, auth tokens, PII).
  static String scrubText(String input) {
    if (input.isEmpty) return input;
    var scrubbed = input;
    scrubbed = scrubbed.replaceAll(_stellarSecretKeyRegex, '[SCRUBBED_SECRET_KEY]');
    scrubbed = scrubbed.replaceAll(_bearerTokenRegex, r'$1[SCRUBBED_TOKEN]');
    scrubbed = scrubbed.replaceAll(_authHeaderRegex, r'$1[SCRUBBED_AUTH]');
    scrubbed = scrubbed.replaceAll(_stellarAddressRegex, '[SCRUBBED_STELLAR_ADDRESS]');
    scrubbed = scrubbed.replaceAll(_txHashRegex, '[SCRUBBED_TX_HASH]');
    scrubbed = scrubbed.replaceAll(_emailRegex, '[SCRUBBED_EMAIL]');
    scrubbed = scrubbed.replaceAll(_cnpjRegex, '[SCRUBBED_CNPJ]');
    scrubbed = scrubbed.replaceAll(_cpfRegex, '[SCRUBBED_CPF]');
    scrubbed = scrubbed.replaceAll(_phoneRegex, '[SCRUBBED_PHONE]');
    return scrubbed;
  }

  /// Scrubs PII, keys, and transaction hashes from a SentryEvent.
  /// Slippay is a non-custodial financial wallet: user identity is never reported.
  static SentryEvent scrubEvent(SentryEvent event) {
    // 1. Scrub message
    SentryMessage? scrubbedMessage;
    if (event.message != null) {
      scrubbedMessage = SentryMessage(
        scrubText(event.message!.formatted),
        template: event.message!.template != null
            ? scrubText(event.message!.template!)
            : null,
        params: event.message!.params
            ?.map((p) => p is String ? scrubText(p) : p)
            .toList(),
      );
    }

    // 2. Scrub exceptions
    List<SentryException>? scrubbedExceptions;
    if (event.exceptions != null) {
      scrubbedExceptions = event.exceptions!.map((exc) {
        return SentryException(
          type: exc.type,
          value: exc.value != null ? scrubText(exc.value!) : null,
          module: exc.module,
          stackTrace: exc.stackTrace,
          threadId: exc.threadId,
          mechanism: exc.mechanism,
        );
      }).toList();
    }

    // 3. Scrub breadcrumbs
    List<Breadcrumb>? scrubbedBreadcrumbs;
    if (event.breadcrumbs != null) {
      scrubbedBreadcrumbs = event.breadcrumbs!.map((crumb) {
        return Breadcrumb(
          message: crumb.message != null ? scrubText(crumb.message!) : null,
          category: crumb.category,
          data: crumb.data?.map(
            (k, v) => MapEntry(k, v is String ? scrubText(v) : v),
          ),
          level: crumb.level,
          timestamp: crumb.timestamp,
          type: crumb.type,
        );
      }).toList();
    }

    // 4. Scrub extra
    Map<String, dynamic>? scrubbedExtra;
    if (event.extra != null) {
      scrubbedExtra = event.extra!.map((k, v) {
        return MapEntry(k, v is String ? scrubText(v) : v);
      });
    }

    // 5. User identity: non-custodial financial wallet must never attach user PII
    return event.copyWith(
      message: scrubbedMessage,
      exceptions: scrubbedExceptions,
      breadcrumbs: scrubbedBreadcrumbs,
      extra: scrubbedExtra,
      user: null,
    );
  }
}
