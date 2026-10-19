import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/core/chain/chain_port.dart';
import 'package:slippay/core/money/usdc_amount.dart';

import '../../helpers/fake_chain_port.dart';

void main() {
  group('ChainPort Models and FakeChainPort', () {
    test('OneTimePayArgs holds correct payment parameters', () {
      final args = OneTimePayArgs(
        buyerAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        merchantAddress: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        platformAddress: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        amount: UsdcAmount.parse('10.50'),
        platformFeeBp: 50,
        memoHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        maxTime: 1700000000,
      );

      expect(args.amount.toHuman(), '10.50');
      expect(args.platformFeeBp, 50);
      expect(args.maxTime, 1700000000);
    });

    test('ApproveArgs holds correct mandate parameters', () {
      final args = ApproveArgs(
        buyerAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        cap: UsdcAmount.parse('25.00'),
        durationSecs: 2592000,
      );

      expect(args.cap.toHuman(), '25.00');
      expect(args.durationSecs, 2592000);
    });

    test('AddressCheck models on-chain existence and trustline state', () {
      const check = AddressCheck(
        validFormat: true,
        accountExists: true,
        hasUsdcTrustline: true,
      );
      expect(check.validFormat, isTrue);
      expect(check.accountExists, isTrue);
      expect(check.hasUsdcTrustline, isTrue);
    });

    group('FakeChainPort', () {
      test('connectWallet returns stubbed wallet address', () async {
        final port = FakeChainPort(walletAddress: 'C_CUSTOM_WALLET');
        expect(await port.connectWallet(), 'C_CUSTOM_WALLET');
        expect(port.connectWalletCalls, 1);
      });

      test('validates address format offline', () {
        final port = FakeChainPort();
        expect(
          port.isValidAddress('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'),
          isTrue,
        );
        expect(
          port.isValidAddress('CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN'),
          isTrue,
        );
        expect(port.isValidAddress('invalid'), isFalse);
        expect(port.isValidAddress(''), isFalse);
      });

      test('checkReceiveAddress returns configured checks and logs address', () async {
        final port = FakeChainPort(hasUsdcTrustline: false);
        const addr = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
        final check = await port.checkReceiveAddress(addr);

        expect(check.validFormat, isTrue);
        expect(check.accountExists, isTrue);
        expect(check.hasUsdcTrustline, isFalse);
        expect(port.lastCheckedAddress, addr);
        expect(port.checkAddressCalls, 1);
      });

      test('payOneTime returns pay hash or throws when configured', () async {
        final port = FakeChainPort(oneTimeHash: 'tx_pay_success_123');
        final args = OneTimePayArgs(
          buyerAddress: 'G_BUYER',
          merchantAddress: 'G_MERCHANT',
          platformAddress: 'G_PLATFORM',
          amount: UsdcAmount.parse('5.00'),
          platformFeeBp: 0,
          memoHex: '00',
          maxTime: 1000,
        );

        final res = await port.payOneTime(args);
        expect(res.hash, 'tx_pay_success_123');
        expect(port.payOneTimeCalls, 1);

        final failingPort = FakeChainPort(shouldThrowOnPay: true);
        expect(() => failingPort.payOneTime(args), throwsA(isA<Exception>()));
      });

      test('approveRecurring returns approve hash or throws when configured', () async {
        final port = FakeChainPort(approveHash: 'tx_approve_success_456');
        final args = ApproveArgs(
          buyerAddress: 'G_BUYER',
          cap: UsdcAmount.parse('12.00'),
        );

        final res = await port.approveRecurring(args);
        expect(res.hash, 'tx_approve_success_456');
        expect(port.approveRecurringCalls, 1);

        final failingPort = FakeChainPort(shouldThrowOnApprove: true);
        expect(() => failingPort.approveRecurring(args), throwsA(isA<Exception>()));
      });
    });
  });
}
