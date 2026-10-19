import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import 'core/config/app_config.dart';
import 'core/observability/crash_report_scrubber.dart';
import 'core/observability/crash_reporter.dart';

/// Single entry that wires error capture + Riverpod, then runs the app.
/// Sentry is initialized when a DSN is configured, and all PII, secret keys,
/// and transaction hashes are scrubbed before sending.
Future<void> bootstrap(Widget Function() builder) async {
  WidgetsFlutterBinding.ensureInitialized();

  // Fail fast: production build cannot ship without crash reporting.
  AppConfig.validate();

  final dsn = AppConfig.sentryDsn.trim();

  void wireFlutterErrorHook() {
    FlutterError.onError = (details) {
      FlutterError.presentError(details);
      if (kReleaseMode || dsn.isNotEmpty) {
        CrashReporter.captureFlutterError(details);
      }
    };
  }

  if (dsn.isNotEmpty) {
    await SentryFlutter.init(
      (options) {
        options.dsn = dsn;
        options.environment = AppConfig.flavor;
        options.sendDefaultPii = false;
        options.beforeSend = (event, {hint}) => CrashReportScrubber.scrubEvent(event);
      },
      appRunner: () async {
        wireFlutterErrorHook();
        runApp(ProviderScope(child: builder()));
      },
    );
  } else {
    wireFlutterErrorHook();
    await runZonedGuarded(() async {
      runApp(ProviderScope(child: builder()));
    }, (error, stack) {
      debugPrint('[bootstrap] uncaught: $error');
      if (kReleaseMode) {
        CrashReporter.captureException(error, stackTrace: stack);
      }
    });
  }

  if (AppConfig.flavor != 'prod') {
    debugPrint('Slippay app · flavor=${AppConfig.flavor} · '
        'network=${AppConfig.stellarNetwork} · rpId=${AppConfig.rpId}');
  }
}

