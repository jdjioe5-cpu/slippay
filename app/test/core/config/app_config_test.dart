import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/core/config/app_config.dart';

void main() {
  group('AppConfig', () {
    test('validate succeeds when dev flavor has empty sentryDsn', () {
      expect(
        () => AppConfig.validate(flavor: 'dev', sentryDsn: ''),
        returnsNormally,
      );
    });

    test('validate succeeds when prod flavor has configured sentryDsn', () {
      expect(
        () => AppConfig.validate(
          flavor: 'prod',
          sentryDsn: 'https://public@sentry.example.com/12345',
        ),
        returnsNormally,
      );
    });

    test('validate fails when prod flavor has empty sentryDsn', () {
      expect(
        () => AppConfig.validate(flavor: 'prod', sentryDsn: ''),
        throwsA(isA<StateError>()),
      );
    });

    test('validate fails when prod flavor has whitespace sentryDsn', () {
      expect(
        () => AppConfig.validate(flavor: 'prod', sentryDsn: '   '),
        throwsA(isA<StateError>()),
      );
    });
  });
}
