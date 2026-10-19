import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/core/chain/chain_port.dart';
import 'package:slippay/core/money/usdc_amount.dart';

class MockChainPort implements ChainPort {
  MockChainPort({this.id = ChainId.stellar});

  @override
  final ChainId id;

  @override
  Future<String> connectWallet() async =>
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

  @override
  bool isValidAddress(String address) {
    if (id == ChainId.stellar) {
      return (address.startsWith('G') || address.startsWith('C')) &&
          address.length == 56;
    }
    return address.length >= 32 && address.length <= 44;
  }

  @override
  Future<AddressCheck> checkReceiveAddress(String address) async {
    final valid = isValidAddress(address);
    if (!valid) {
      return const AddressCheck(
        validFormat: false,
        accountExists: false,
        hasUsdcTrustline: false,
      );
    }
    return const AddressCheck(
      validFormat: true,
      accountExists: true,
      hasUsdcTrustline: true,
    );
  }

  @override
  Future<PayResult> payOneTime(OneTimePayArgs args) async {
    return PayResult('tx_${args.memoHex}');
  }

  @override
  Future<PayResult> approveRecurring(ApproveArgs args) async {
    return const PayResult('tx_approve');
  }
}

void main() {
  group('ChainPort Models and Contract', () {
    test('AddressCheck stores validity and trustline flags', () {
      const check = AddressCheck(
        validFormat: true,
        accountExists: true,
        hasUsdcTrustline: false,
      );
      expect(check.validFormat, isTrue);
      expect(check.accountExists, isTrue);
      expect(check.hasUsdcTrustline, isFalse);
    });

    test('OneTimePayArgs holds exact fee and payment fields', () {
      final args = OneTimePayArgs(
        buyerAddress: 'G_BUYER',
        merchantAddress: 'G_MERCHANT',
        platformAddress: 'G_PLATFORM',
        amount: UsdcAmount.parse('10.50'),
        platformFeeBp: 297,
        memoHex: 'a' * 64,
        maxTime: 1700000000,
      );

      expect(args.buyerAddress, equals('G_BUYER'));
      expect(args.merchantAddress, equals('G_MERCHANT'));
      expect(args.platformAddress, equals('G_PLATFORM'));
      expect(args.amount.toHuman(), equals('10.50'));
      expect(args.platformFeeBp, equals(297));
      expect(args.memoHex.length, equals(64));
      expect(args.maxTime, equals(1700000000));
    });

    test('ApproveArgs supports custom cap and optional duration', () {
      final args = ApproveArgs(
        buyerAddress: 'G_BUYER',
        cap: UsdcAmount.parse('100'),
        durationSecs: 3600,
      );
      expect(args.buyerAddress, equals('G_BUYER'));
      expect(args.cap.toHuman(), equals('100.00'));
      expect(args.durationSecs, equals(3600));

      final defaultDuration = ApproveArgs(
        buyerAddress: 'G_BUYER',
        cap: UsdcAmount.parse('50'),
      );
      expect(defaultDuration.durationSecs, isNull);
    });

    test('ChainPort implementation satisfies contract', () async {
      final port = MockChainPort();
      expect(port.id, equals(ChainId.stellar));

      final addr = await port.connectWallet();
      expect(port.isValidAddress(addr), isTrue);
      expect(port.isValidAddress('invalid_addr'), isFalse);

      final check = await port.checkReceiveAddress(addr);
      expect(check.validFormat, isTrue);
      expect(check.accountExists, isTrue);
      expect(check.hasUsdcTrustline, isTrue);

      final payResult = await port.payOneTime(
        OneTimePayArgs(
          buyerAddress: addr,
          merchantAddress: addr,
          platformAddress: addr,
          amount: UsdcAmount.parse('1'),
          platformFeeBp: 297,
          memoHex: 'b' * 64,
          maxTime: 1800000000,
        ),
      );
      expect(payResult.hash, equals('tx_${'b' * 64}'));

      final approveResult = await port.approveRecurring(
        ApproveArgs(buyerAddress: addr, cap: UsdcAmount.parse('20')),
      );
      expect(approveResult.hash, equals('tx_approve'));
    });
  });
}
