import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/features/wallet/domain/wallet.dart';
import 'package:slippay/features/wallet/presentation/account_screen.dart';
import 'package:slippay/features/wallet/presentation/wallet_controller.dart';

void main() {
  const testWallet = Wallet(
    address: 'CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN',
    credentialId: 'credential_12345',
    deployed: true,
  );

  group('AccountScreen Recovery Boundary and Controls', () {
    testWidgets('renders wallet address, security badges, and single-device warning', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            walletControllerProvider.overrideWith(() => _MockWalletController(testWallet)),
          ],
          child: const MaterialApp(
            home: AccountScreen(),
          ),
        ),
      );

      // Verify wallet address
      expect(find.text('ENDEREÇO DA CARTEIRA'), findsOneWidget);
      expect(find.text(testWallet.address), findsOneWidget);

      // Verify security items
      expect(find.text('Biometria'), findsOneWidget);
      expect(find.text('Non-custodial'), findsOneWidget);

      // Verify single-device limit documentation
      expect(find.text('RECUPERAÇÃO E LIMITES'), findsOneWidget);
      expect(find.text('Dispositivo único (v0.1)'), findsOneWidget);
      expect(
        find.textContaining('A adição de um segundo signer para recuperação em múltiplos dispositivos ainda não está ativa no contrato on-chain'),
        findsOneWidget,
      );
    });

    testWidgets('does NOT render the non-functional ADICIONAR RECUPERAÇÃO button', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            walletControllerProvider.overrideWith(() => _MockWalletController(testWallet)),
          ],
          child: const MaterialApp(
            home: AccountScreen(),
          ),
        ),
      );

      // Acceptance criterion: A security control that does nothing is absent
      expect(find.text('ADICIONAR RECUPERAÇÃO'), findsNothing);
    });

    testWidgets('renders sign out button', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            walletControllerProvider.overrideWith(() => _MockWalletController(testWallet)),
          ],
          child: const MaterialApp(
            home: AccountScreen(),
          ),
        ),
      );

      expect(find.text('sair deste aparelho'), findsOneWidget);
    });
  });
}

class _MockWalletController extends WalletController {
  _MockWalletController(this._initialWallet);
  final Wallet? _initialWallet;

  @override
  Future<Wallet?> build() async => _initialWallet;
}
