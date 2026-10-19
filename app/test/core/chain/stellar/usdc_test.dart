import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/core/chain/stellar/usdc.dart';

void main() {
  group('StellarConstants', () {
    test('networkFromString parses case-insensitively', () {
      expect(StellarConstants.networkFromString('PUBLIC'), equals(StellarNetwork.public));
      expect(StellarConstants.networkFromString('public'), equals(StellarNetwork.public));
      expect(StellarConstants.networkFromString('TESTNET'), equals(StellarNetwork.testnet));
      expect(StellarConstants.networkFromString('testnet'), equals(StellarNetwork.testnet));
      expect(StellarConstants.networkFromString('unknown'), equals(StellarNetwork.testnet));
    });

    test('usdcIssuer maps to verified Circle addresses', () {
      expect(
        StellarConstants.usdcIssuer[StellarNetwork.public],
        equals('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'),
      );
      expect(
        StellarConstants.usdcIssuer[StellarNetwork.testnet],
        equals('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'),
      );
    });

    test('passphrase returns official network passphrases', () {
      expect(
        StellarConstants.passphrase(StellarNetwork.public),
        equals('Public Global Stellar Network ; September 2015'),
      );
      expect(
        StellarConstants.passphrase(StellarNetwork.testnet),
        equals('Test SDF Network ; September 2015'),
      );
    });

    test('contract and asset constants match specification', () {
      expect(StellarConstants.assetCode, equals('USDC'));
      expect(
        StellarConstants.subscriptionContractMainnet,
        equals('CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN'),
      );
      expect(StellarConstants.subscriptionContractMainnet.length, equals(56));
      expect(StellarConstants.subscriptionContractMainnet.startsWith('C'), isTrue);
    });
  });
}
