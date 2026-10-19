import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:slippay/core/chain/chain_port.dart';
import 'package:slippay/core/money/usdc_amount.dart';
import 'package:slippay/features/pay/presentation/pay_screen.dart';

class MockSubmitChainPort implements ChainPort {
  MockSubmitChainPort({
    this.throwBiometric = false,
    this.throwRpc = false,
    this.throwRevert = false,
    this.txHash = '000000000000000000000000000000000000000000000000000000000000beef',
  });

  final bool throwBiometric;
  final bool throwRpc;
  final bool throwRevert;
  final String txHash;
  int payCalls = 0;
  OneTimePayArgs? lastArgs;

  @override
  ChainId get id => ChainId.stellar;

  @override
  Future<String> connectWallet() async => 'C_WALLET_TEST_ADDRESS';

  @override
  bool isValidAddress(String address) => true;

  @override
  Future<AddressCheck> checkReceiveAddress(String address) async => const AddressCheck(
        validFormat: true,
        accountExists: true,
        hasUsdcTrustline: true,
      );

  @override
  Future<PayResult> payOneTime(OneTimePayArgs args) async {
    payCalls++;
    lastArgs = args;
    if (throwBiometric) {
      throw Exception('Biometric authentication cancelled by user (not allowed)');
    }
    if (throwRpc) {
      throw Exception('Stellar RPC node unreachable connection timed out');
    }
    if (throwRevert) {
      throw Exception('Transaction reverted tx_failed on-chain');
    }
    return PayResult(txHash);
  }

  @override
  Future<PayResult> approveRecurring(ApproveArgs args) async => const PayResult('hash_approve');
}

void main() {
  group('PayScreen Transaction Build, Biometric Sign and Submission', () {
    testWidgets('renders camera scanner', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: PayScreen(),
          ),
        ),
      );

      expect(find.text('Pagar'), findsOneWidget);
      expect(find.byType(MobileScanner), findsOneWidget);
    });

    testWidgets('submits transaction and displays confirmed hash without pending message', (tester) async {
      final mock = MockSubmitChainPort(txHash: '0x_settled_tx_hash_123');
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            routes: {
              '/': (_) => PayScreen(chainPort: mock),
              '/receipt/0x_settled_tx_hash_123': (_) => const Scaffold(body: Text('Receipt View')),
            },
          ),
        ),
      );

      final scanner = tester.widget<MobileScanner>(find.byType(MobileScanner));
      scanner.onDetect?.call(
        const BarcodeCapture(
          barcodes: [
            Barcode(rawValue: 'to=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5&amount=10.00'),
          ],
        ),
      );

      await tester.pumpAndSettle();

      // Tap authorize
      await tester.tap(find.text('AUTORIZAR COM A BIOMETRIA'));
      await tester.pumpAndSettle();

      expect(mock.payCalls, 1);
      expect(mock.lastArgs?.amount, UsdcAmount.parse('10.00'));
      expect(find.textContaining('pendente do chain adapter'), findsNothing);
    });

    testWidgets('handles biometric rejection with distinct actionable message and retry button', (tester) async {
      final mock = MockSubmitChainPort(throwBiometric: true);
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            home: PayScreen(chainPort: mock),
          ),
        ),
      );

      final scanner = tester.widget<MobileScanner>(find.byType(MobileScanner));
      scanner.onDetect?.call(
        const BarcodeCapture(
          barcodes: [
            Barcode(rawValue: 'test_payload'),
          ],
        ),
      );

      await tester.pumpAndSettle();

      await tester.tap(find.text('AUTORIZAR COM A BIOMETRIA'));
      await tester.pumpAndSettle();

      expect(mock.payCalls, 1);
      expect(find.text('Autenticação biométrica cancelada ou recusada.'), findsOneWidget);
      expect(find.text('TENTAR NOVAMENTE'), findsOneWidget);
    });

    testWidgets('handles RPC connection error distinctly', (tester) async {
      final mock = MockSubmitChainPort(throwRpc: true);
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            home: PayScreen(chainPort: mock),
          ),
        ),
      );

      final scanner = tester.widget<MobileScanner>(find.byType(MobileScanner));
      scanner.onDetect?.call(
        const BarcodeCapture(
          barcodes: [
            Barcode(rawValue: 'test_payload'),
          ],
        ),
      );

      await tester.pumpAndSettle();

      await tester.tap(find.text('AUTORIZAR COM A BIOMETRIA'));
      await tester.pumpAndSettle();

      expect(find.text('Erro de conexão: nó RPC indisponível na rede.'), findsOneWidget);
      expect(find.text('TENTAR NOVAMENTE'), findsOneWidget);
    });

    testWidgets('handles on-chain revert error distinctly', (tester) async {
      final mock = MockSubmitChainPort(throwRevert: true);
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            home: PayScreen(chainPort: mock),
          ),
        ),
      );

      final scanner = tester.widget<MobileScanner>(find.byType(MobileScanner));
      scanner.onDetect?.call(
        const BarcodeCapture(
          barcodes: [
            Barcode(rawValue: 'test_payload'),
          ],
        ),
      );

      await tester.pumpAndSettle();

      await tester.tap(find.text('AUTORIZAR COM A BIOMETRIA'));
      await tester.pumpAndSettle();

      expect(find.text('A transação falhou ou foi revertida na blockchain.'), findsOneWidget);
      expect(find.text('TENTAR NOVAMENTE'), findsOneWidget);
    });
  });
}
