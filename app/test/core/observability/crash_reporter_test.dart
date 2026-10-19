import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/core/observability/crash_reporter.dart';

void main() {
  group('CrashReporter', () {
    tearDown(() {
      CrashReporter.customReporterForTesting = null;
    });

    test('captureException invokes registered reporter', () async {
      Object? capturedError;
      StackTrace? capturedStack;

      CrashReporter.customReporterForTesting = (throwable, {dynamic stackTrace, dynamic hint}) async {
        capturedError = throwable;
        capturedStack = stackTrace as StackTrace?;
      };

      final error = Exception('Payment simulation failed');
      final stack = StackTrace.current;

      await CrashReporter.captureException(error, stackTrace: stack);

      expect(capturedError, equals(error));
      expect(capturedStack, equals(stack));
    });

    test('captureFlutterError forwards exception and stack trace', () async {
      Object? capturedError;
      StackTrace? capturedStack;

      CrashReporter.customReporterForTesting = (throwable, {dynamic stackTrace, dynamic hint}) async {
        capturedError = throwable;
        capturedStack = stackTrace as StackTrace?;
      };

      final error = FlutterError('Widget build error');
      final details = FlutterErrorDetails(
        exception: error,
        stack: StackTrace.current,
      );

      await CrashReporter.captureFlutterError(details);

      expect(capturedError, equals(error));
      expect(capturedStack, equals(details.stack));
    });
  });
}
