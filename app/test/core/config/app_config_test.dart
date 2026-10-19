import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/core/config/app_config.dart';

void main() {
  group('AppConfig single-environment resolution and consistency', () {
    test('default-constructed config names a single consistent dev/testnet environment', () {
      const config = AppConfig();

      expect(config.flavor, equals('dev'));
      expect(config.chain, equals('stellar'));
      expect(config.stellarNetwork, equals('TESTNET'));
      expect(config.sorobanRpc, equals('https://soroban-testnet.stellar.org'));
      expect(config.horizonUrl, equals('https://horizon-testnet.stellar.org'));
      expect(config.networkPassphrase, equals('Test SDF Network ; September 2015'));
      expect(config.rpId, equals('localhost'));
      expect(config.apiBase, equals('http://localhost:54321/functions/v1/api'));
      expect(config.isProd, isFalse);
      expect(config.isConsistent, isTrue);

      // Startup validation must succeed for the consistent default
      expect(() => config.validateInvariants(), returnsNormally);
    });

    test('prod-flavored config resolves consistent production environment', () {
      const config = AppConfig(flavorOverride: 'prod');

      expect(config.flavor, equals('prod'));
      expect(config.chain, equals('stellar'));
      expect(config.stellarNetwork, equals('PUBLIC'));
      expect(config.sorobanRpc, equals('https://mainnet.sorobanrpc.com'));
      expect(config.horizonUrl, equals('https://horizon.stellar.org'));
      expect(config.networkPassphrase, equals('Public Global Stellar Network ; September 2015'));
      expect(config.rpId, equals('app.slippay.cc'));
      expect(config.apiBase, equals('https://api.slippay.cc/api'));
      expect(config.isProd, isTrue);
      expect(config.isConsistent, isTrue);

      expect(() => config.validateInvariants(), returnsNormally);
    });

    test('isProd cannot be true while production endpoints are absent', () {
      // Flavor is 'prod', but stellar network is left as TESTNET
      const config = AppConfig(
        flavorOverride: 'prod',
        stellarNetworkOverride: 'TESTNET',
        networkPassphraseOverride: 'Test SDF Network ; September 2015',
      );

      expect(config.isProd, isFalse);
      expect(
        () => config.validateInvariants(),
        throwsA(
          isA<StateError>().having(
            (e) => e.message,
            'message',
            contains("Flavor 'prod' configured with non-production endpoints"),
          ),
        ),
      );
    });

    test('isProd cannot be true when apiBase points to localhost', () {
      const config = AppConfig(
        flavorOverride: 'prod',
        apiBaseOverride: 'http://localhost:54321/functions/v1/api',
      );

      expect(config.isProd, isFalse);
      expect(() => config.validateInvariants(), throwsA(isA<StateError>()));
    });

    test('mismatched passphrase and network fail at startup with both values named', () {
      const mismatchedTestnet = AppConfig(
        stellarNetworkOverride: 'TESTNET',
        networkPassphraseOverride: 'Public Global Stellar Network ; September 2015',
      );

      expect(
        () => mismatchedTestnet.validateInvariants(),
        throwsA(
          isA<StateError>()
              .having((e) => e.message, 'message', contains('TESTNET'))
              .having((e) => e.message, 'message', contains('Public Global Stellar Network ; September 2015')),
        ),
      );

      const mismatchedPublic = AppConfig(
        flavorOverride: 'prod',
        stellarNetworkOverride: 'PUBLIC',
        networkPassphraseOverride: 'Test SDF Network ; September 2015',
      );

      expect(
        () => mismatchedPublic.validateInvariants(),
        throwsA(
          isA<StateError>()
              .having((e) => e.message, 'message', contains('PUBLIC'))
              .having((e) => e.message, 'message', contains('Test SDF Network ; September 2015')),
        ),
      );
    });

    test('unknown chain value fails with chain named in error', () {
      const badChain = AppConfig(chainOverride: 'avalanche');

      expect(
        () => badChain.validateInvariants(),
        throwsA(
          isA<StateError>().having(
            (e) => e.message,
            'message',
            allOf(contains('avalanche'), contains('Supported chains')),
          ),
        ),
      );
    });

    test('static AppConfig mirrors the default consistent instance', () {
      expect(AppConfig.flavor, equals('dev'));
      expect(AppConfig.chain, equals('stellar'));
      expect(AppConfig.stellarNetwork, equals('TESTNET'));
      expect(AppConfig.networkPassphrase, equals('Test SDF Network ; September 2015'));
      expect(AppConfig.isProd, isFalse);
      expect(() => AppConfig.validate(), returnsNormally);
    });
  });
}
