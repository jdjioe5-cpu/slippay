import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import '../config/app_config.dart';

typedef ErrorReporter = Future<void> Function(
  Object throwable, {
  dynamic stackTrace,
  dynamic hint,
});

/// Central crash reporter facade that forwards errors to Sentry when configured.
class CrashReporter {
  const CrashReporter._();

  @visibleForTesting
  static ErrorReporter? customReporterForTesting;

  /// Reports an uncaught exception or error to Sentry if a DSN is configured.
  static Future<void> captureException(
    Object throwable, {
    dynamic stackTrace,
    dynamic hint,
  }) async {
    if (customReporterForTesting != null) {
      await customReporterForTesting!(
        throwable,
        stackTrace: stackTrace,
        hint: hint,
      );
      return;
    }

    final dsn = AppConfig.sentryDsn.trim();
    if (dsn.isEmpty) return;

    await Sentry.captureException(
      throwable,
      stackTrace: stackTrace,
      hint: hint,
    );
  }

  /// Reports a Flutter framework error to Sentry if a DSN is configured.
  static Future<void> captureFlutterError(FlutterErrorDetails details) async {
    await captureException(
      details.exception,
      stackTrace: details.stack,
    );
  }
}
