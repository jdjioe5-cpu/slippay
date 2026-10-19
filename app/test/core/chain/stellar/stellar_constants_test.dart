import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/core/chain/stellar/usdc.dart';

File? _findWebAdapterFile() {
  final candidates = [
    '../apps/web/src/lib/chain/stellar/adapter.ts',
    '../../apps/web/src/lib/chain/stellar/adapter.ts',
    'apps/web/src/lib/chain/stellar/adapter.ts',
    '../../../apps/web/src/lib/chain/stellar/adapter.ts',
  ];
  for (final c in candidates) {
    final f = File(c);
    if (f.existsSync()) return f;
  }
  return null;
}

void main() {
  group('StellarConstants', () {
    test('has valid USDC issuer addresses for testnet and public', () {
      final testnetIssuer = StellarConstants.usdcIssuer[StellarNetwork.testnet];
      final publicIssuer = StellarConstants.usdcIssuer[StellarNetwork.public];

      expect(testnetIssuer, 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
      expect(publicIssuer, 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
    });

    test('has valid subscriptionContractMainnet', () {
      expect(
        StellarConstants.subscriptionContractMainnet,
        'CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN',
      );
    });

    test('assetCode is USDC', () {
      expect(StellarConstants.assetCode, 'USDC');
    });

    group('networkFromString', () {
      test('accepts PUBLIC and MAINNET (case-insensitive)', () {
        expect(StellarConstants.networkFromString('PUBLIC'), StellarNetwork.public);
        expect(StellarConstants.networkFromString('public'), StellarNetwork.public);
        expect(StellarConstants.networkFromString('MAINNET'), StellarNetwork.public);
        expect(StellarConstants.networkFromString('mainnet'), StellarNetwork.public);
      });

      test('accepts TESTNET (case-insensitive)', () {
        expect(StellarConstants.networkFromString('TESTNET'), StellarNetwork.testnet);
        expect(StellarConstants.networkFromString('testnet'), StellarNetwork.testnet);
      });

      test('rejects invalid or unknown network strings with ArgumentError', () {
        expect(
          () => StellarConstants.networkFromString('unknown'),
          throwsA(isA<ArgumentError>()),
        );
        expect(
          () => StellarConstants.networkFromString(''),
          throwsA(isA<ArgumentError>()),
        );
        expect(
          () => StellarConstants.networkFromString('solana'),
          throwsA(isA<ArgumentError>()),
        );
      });
    });

    group('passphrase', () {
      test('returns correct network passphrases', () {
        expect(
          StellarConstants.passphrase(StellarNetwork.public),
          'Public Global Stellar Network ; September 2015',
        );
        expect(
          StellarConstants.passphrase(StellarNetwork.testnet),
          'Test SDF Network ; September 2015',
        );
      });
    });

    test('matches constants defined in web adapter (apps/web/src/lib/chain/stellar/adapter.ts)', () {
      final webFile = _findWebAdapterFile();
      expect(webFile, isNotNull, reason: 'Could not find web adapter.ts to verify constants against');

      final content = webFile!.readAsStringSync();

      // Extract USDC_ISSUER for TESTNET and PUBLIC
      final testnetMatch = RegExp(r'TESTNET:\s*"([A-Z0-9]+)"').firstMatch(content);
      final publicMatch = RegExp(r'PUBLIC:\s*"([A-Z0-9]+)"').firstMatch(content);

      expect(testnetMatch, isNotNull);
      expect(publicMatch, isNotNull);

      final webTestnetIssuer = testnetMatch!.group(1);
      final webPublicIssuer = publicMatch!.group(1);

      expect(
        StellarConstants.usdcIssuer[StellarNetwork.testnet],
        equals(webTestnetIssuer),
        reason: 'Flutter testnet USDC issuer must match web adapter',
      );
      expect(
        StellarConstants.usdcIssuer[StellarNetwork.public],
        equals(webPublicIssuer),
        reason: 'Flutter public USDC issuer must match web adapter',
      );

      // Extract SUB_CONTRACT default constant
      final subContractMatch = RegExp(r'\?\?\s*"([A-Z0-9]+)"').firstMatch(content);
      expect(subContractMatch, isNotNull);

      final webSubContract = subContractMatch!.group(1);
      expect(
        StellarConstants.subscriptionContractMainnet,
        equals(webSubContract),
        reason: 'Flutter subscription contract must match web adapter default',
      );
    });
  });
}
