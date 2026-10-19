import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import 'wallet_controller.dart';

/// Account: the wallet address, signers, and recovery. Mirrors web Account.tsx.
/// A second signer (recovery) is non-negotiable in the passkey model: lost phone
/// with a single passkey = lost funds.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wallet = ref.watch(walletControllerProvider).valueOrNull;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.bone,
        elevation: 0,
        title: const Text('Conta', style: TextStyle(color: AppColors.ink)),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(28),
          children: [
            _label('ENDEREÇO DA CARTEIRA'),
            const SizedBox(height: 8),
            SelectableText(
              wallet?.address ?? '',
              style: const TextStyle(fontFamily: 'monospace', fontSize: 13, color: AppColors.ink),
            ),
            const SizedBox(height: 28),
            _label('SEGURANÇA'),
            const SizedBox(height: 8),
            _row(Icons.fingerprint, 'Biometria', 'Face ID / digital deste aparelho'),
            _row(Icons.shield_outlined, 'Non-custodial',
                'A chave nunca sai do aparelho. O Slippay não move seu dinheiro.'),
            const SizedBox(height: 16),
            _label('RECUPERAÇÃO E LIMITES'),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0x14B4402F),
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.warning_amber_rounded, size: 18, color: AppColors.leak),
                      SizedBox(width: 8),
                      Text(
                        'Dispositivo único (v0.1)',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: AppColors.leak,
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 8),
                  Text(
                    'Esta carteira utiliza autenticação passkey restrita ao chip de segurança deste aparelho. '
                    'A adição de um segundo signer para recuperação em múltiplos dispositivos ainda não está ativa no contrato on-chain. '
                    'Perder este aparelho ou os dados biométricos locais resultará na perda irreversível do acesso aos fundos.',
                    style: TextStyle(fontSize: 12, color: AppColors.ink, height: 1.4),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),
            TextButton(
              onPressed: () {
                ref.read(walletControllerProvider.notifier).disconnect();
                context.go('/onboarding');
              },
              child: const Text('sair deste aparelho', style: TextStyle(color: AppColors.gray)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _label(String s) => Text(
        s,
        style: const TextStyle(
          fontFamily: 'monospace',
          fontSize: 10,
          letterSpacing: 2,
          color: AppColors.gray,
        ),
      );

  Widget _row(IconData icon, String title, String sub) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 20, color: AppColors.ink),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink)),
                  Text(sub, style: const TextStyle(fontSize: 13, color: AppColors.gray)),
                ],
              ),
            ),
          ],
        ),
      );
}
