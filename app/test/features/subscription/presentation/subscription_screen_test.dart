import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/core/chain/chain_port.dart';
import 'package:slippay/core/money/usdc_amount.dart';
import 'package:slippay/features/subscription/presentation/subscription_screen.dart';

class MockChainPort implements ChainPort {
  MockChainPort({
    this.shouldThrow = false,
    this.txHash = '0000000000000000000000000000000000000000000000000000000000000042',
  });

  final bool shouldThrow;
  final String txHash;
  ApproveArgs? lastApproveArgs;
  int approveCalls = 0;

  @override
  ChainId get id => ChainId.stellar;

  @override
  Future<String> connectWallet() async => 'C_MOCK_WALLET_ADDRESS';

  @override
  bool isValidAddress(String address) => true;

  @override
  Future<AddressCheck> checkReceiveAddress(String address) async => const AddressCheck(
        validFormat: true,
        accountExists: true,
        hasUsdcTrustline: true,
      );

  @override
  Future<PayResult> payOneTime(OneTimePayArgs args) async => PayResult(txHash);

  @override
  Future<PayResult> approveRecurring(ApproveArgs args) async {
    approveCalls++;
    lastApproveArgs = args;
    if (shouldThrow) {
      throw Exception('Biometric rejection or on-chain revert');
    }
    return PayResult(txHash);
  }
}

void main() {
  group('SubscriptionScreen Mandate Approval', () {
    testWidgets('renders form fields, duration dropdown and biometric button', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: SubscriptionScreen(),
          ),
        ),
      );

      expect(find.text('Você define o teto.\nNunca passa disso.'), findsOneWidget);
      expect(find.text('LIMITE MENSAL · USDC'), findsOneWidget);
      expect(find.text('DURAÇÃO DA AUTORIZAÇÃO'), findsOneWidget);
      expect(find.text('30 dias (mensal)'), findsOneWidget);
      expect(find.text('AUTORIZAR COM A BIOMETRIA'), findsOneWidget);
    });

    testWidgets('rejects zero cap before calling approveRecurring', (tester) async {
      final mock = MockChainPort();
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            home: SubscriptionScreen(chainPort: mock),
          ),
        ),
      );

      final textField = find.byType(TextField);
      await tester.enterText(textField, '0');
      await tester.tap(find.text('AUTORIZAR COM A BIOMETRIA'));
      await tester.pumpAndSettle();

      expect(find.text('defina um limite maior que zero'), findsOneWidget);
      expect(mock.approveCalls, 0);
    });

    testWidgets('rejects invalid cap format before calling approveRecurring', (tester) async {
      final mock = MockChainPort();
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            home: SubscriptionScreen(chainPort: mock),
          ),
        ),
      );

      final textField = find.byType(TextField);
      await tester.enterText(textField, 'invalid-num');
      await tester.tap(find.text('AUTORIZAR COM A BIOMETRIA'));
      await tester.pumpAndSettle();

      expect(find.text('valor inválido'), findsOneWidget);
      expect(mock.approveCalls, 0);
    });

    testWidgets('submits non-zero cap and duration, confirms on-chain state and shows dual details', (tester) async {
      final mock = MockChainPort(txHash: 'tx_sub_mandate_hash_999');
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            home: SubscriptionScreen(chainPort: mock),
          ),
        ),
      );

      final textField = find.byType(TextField);
      await tester.enterText(textField, '25.00');

      // Change duration dropdown to 90 dias
      await tester.tap(find.text('30 dias (mensal)'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('90 dias (trimestral)').last);
      await tester.pumpAndSettle();

      await tester.tap(find.text('AUTORIZAR COM A BIOMETRIA'));
      await tester.pumpAndSettle();

      expect(mock.approveCalls, 1);
      expect(mock.lastApproveArgs?.cap, UsdcAmount.parse('25.00'));
      expect(mock.lastApproveArgs?.durationSecs, 7776000);

      // Verify on-chain confirmed card
      expect(find.text('Mandato ativo on-chain'), findsOneWidget);
      expect(find.text('tx_sub_mandate_hash_999'), findsOneWidget);
      expect(find.text('\$25.00 USDC'), findsOneWidget);
      expect(find.text('90 dias (trimestral)'), findsOneWidget);

      // Verify SnackBar naming both cap and duration
      expect(
        find.text('Mandato ativado: até \$25.00 válido por 90 dias (trimestral)'),
        findsOneWidget,
      );
    });

    testWidgets('handles rejected approval gracefully and allows retry without fake success', (tester) async {
      final mock = MockChainPort(shouldThrow: true);
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            home: SubscriptionScreen(chainPort: mock),
          ),
        ),
      );

      await tester.tap(find.text('AUTORIZAR COM A BIOMETRIA'));
      await tester.pumpAndSettle();

      expect(mock.approveCalls, 1);
      expect(find.text('Mandato ativo on-chain'), findsNothing);
      expect(find.textContaining('falha na autorização'), findsOneWidget);
      expect(find.text('AUTORIZAR COM A BIOMETRIA'), findsOneWidget);
    });
  });
}
