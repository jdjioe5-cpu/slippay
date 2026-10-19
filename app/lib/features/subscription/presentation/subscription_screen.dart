import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/chain/chain_port.dart';
import '../../../core/chain/chain_provider.dart';
import '../../../core/money/usdc_amount.dart';
import '../../../core/theme/app_theme.dart';
import '../../wallet/presentation/wallet_controller.dart';

/// Confirmed recurring mandate state persisted on-chain.
class ConfirmedMandate {
  const ConfirmedMandate({
    required this.mandateId,
    required this.cap,
    required this.durationSecs,
    required this.confirmedAt,
  });

  final String mandateId;
  final UsdcAmount cap;
  final int durationSecs;
  final DateTime confirmedAt;
}

/// Recurring authorization: the owner approves a spending cap that a recurring
/// debit may draw up to, enforced on-chain by the subscription contract (the
/// SEP-41 spender). Mirrors web Sub / PolicySubscribe. The cap + duration are the
/// guardrail: the agent/merchant can never exceed them.
class SubscriptionScreen extends ConsumerStatefulWidget {
  const SubscriptionScreen({
    this.chainPort,
    super.key,
  });

  /// Optional ChainPort override for testing/mocking.
  final ChainPort? chainPort;

  @override
  ConsumerState<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends ConsumerState<SubscriptionScreen> {
  final _capController = TextEditingController(text: '12.00');
  String? _error;
  bool _isSubmitting = false;
  int _durationSecs = 2592000; // 30 days default (30 * 86400)
  ConfirmedMandate? _confirmedMandate;

  @override
  void dispose() {
    _capController.dispose();
    super.dispose();
  }

  String _formatDuration(int secs) {
    final days = secs ~/ 86400;
    if (days == 30) return '30 dias (mensal)';
    if (days == 90) return '90 dias (trimestral)';
    if (days == 270) return '270 dias (~9 meses)';
    return '$days dias';
  }

  Future<void> _approve() async {
    setState(() {
      _error = null;
    });

    final UsdcAmount cap;
    try {
      cap = UsdcAmount.parse(_capController.text);
      if (cap == UsdcAmount.zero) {
        setState(() => _error = 'defina um limite maior que zero');
        return;
      }
    } on FormatException {
      setState(() => _error = 'valor inválido');
      return;
    }

    setState(() {
      _isSubmitting = true;
    });

    try {
      final port = widget.chainPort ?? ref.read(chainPortProvider);
      final walletAddress = ref.read(walletControllerProvider).valueOrNull?.address ??
          await port.connectWallet();

      final result = await port.approveRecurring(
        ApproveArgs(
          buyerAddress: walletAddress,
          cap: cap,
          durationSecs: _durationSecs,
        ),
      );

      if (!mounted) return;

      final mandate = ConfirmedMandate(
        mandateId: result.hash,
        cap: cap,
        durationSecs: _durationSecs,
        confirmedAt: DateTime.now(),
      );

      setState(() {
        _isSubmitting = false;
        _confirmedMandate = mandate;
      });

      final durationText = _formatDuration(_durationSecs);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Mandato ativado: até \$${cap.toHuman()} válido por $durationText',
          ),
          duration: const Duration(seconds: 4),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        _error = 'falha na autorização: ${e.toString()}';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.bone,
        elevation: 0,
        title: const Text('Autorização recorrente', style: TextStyle(color: AppColors.ink)),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: _confirmedMandate != null ? _buildConfirmedView(_confirmedMandate!) : _buildFormView(),
        ),
      ),
    );
  }

  Widget _buildConfirmedView(ConfirmedMandate mandate) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 12),
        const Row(
          children: [
            Icon(Icons.check_circle, size: 28, color: AppColors.ok),
            SizedBox(width: 8),
            Text(
              'Mandato ativo on-chain',
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 14,
                letterSpacing: 1.5,
                fontWeight: FontWeight.bold,
                color: AppColors.ok,
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),
        const Text(
          'Autorizado.',
          style: TextStyle(fontSize: 32, fontWeight: FontWeight.w900, color: AppColors.ink),
        ),
        const SizedBox(height: 8),
        const Text(
          'O contrato on-chain agora autoriza cobranças recorrentes estritamente limitadas pelo teto e duração confirmados.',
          style: TextStyle(fontSize: 15, color: AppColors.gray, height: 1.4),
        ),
        const SizedBox(height: 32),
        _detailRow('MANDATO / TX HASH', mandate.mandateId),
        const SizedBox(height: 16),
        _detailRow('TETO MÁXIMO', '\$${mandate.cap.toHuman()} USDC'),
        const SizedBox(height: 16),
        _detailRow('DURAÇÃO AUTORIZADA', _formatDuration(mandate.durationSecs)),
        const Spacer(),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton(
            onPressed: () {
              setState(() {
                _confirmedMandate = null;
              });
            },
            child: const Text('ALTERAR AUTORIZAÇÃO'),
          ),
        ),
      ],
    );
  }

  Widget _detailRow(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontFamily: 'monospace',
            fontSize: 10,
            letterSpacing: 2,
            color: AppColors.gray,
          ),
        ),
        const SizedBox(height: 4),
        SelectableText(
          value,
          style: const TextStyle(
            fontFamily: 'monospace',
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: AppColors.ink,
          ),
        ),
      ],
    );
  }

  Widget _buildFormView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 8),
        const Text(
          'Você define o teto.\nNunca passa disso.',
          style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppColors.ink, height: 1.05),
        ),
        const SizedBox(height: 14),
        const Text(
          'A cobrança recorrente só pode sacar até o limite que você aprovar, '
          'travado no contrato on-chain. Acima disso, trava.',
          style: TextStyle(fontSize: 15, color: AppColors.gray, height: 1.4),
        ),
        const SizedBox(height: 28),
        const Text(
          'LIMITE MENSAL · USDC',
          style: TextStyle(fontFamily: 'monospace', fontSize: 10, letterSpacing: 2, color: AppColors.gray),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _capController,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: AppColors.ink),
          decoration: InputDecoration(
            prefixText: '\$ ',
            errorText: _error,
            border: const UnderlineInputBorder(),
          ),
        ),
        const SizedBox(height: 24),
        const Text(
          'DURAÇÃO DA AUTORIZAÇÃO',
          style: TextStyle(fontFamily: 'monospace', fontSize: 10, letterSpacing: 2, color: AppColors.gray),
        ),
        const SizedBox(height: 8),
        DropdownButtonFormField<int>(
          value: _durationSecs,
          decoration: const InputDecoration(
            border: UnderlineInputBorder(),
            contentPadding: EdgeInsets.symmetric(vertical: 8),
          ),
          items: const [
            DropdownMenuItem(value: 2592000, child: Text('30 dias (mensal)')),
            DropdownMenuItem(value: 7776000, child: Text('90 dias (trimestral)')),
            DropdownMenuItem(value: 23328000, child: Text('270 dias (~9 meses)')),
          ],
          onChanged: _isSubmitting
              ? null
              : (val) {
                  if (val != null) setState(() => _durationSecs = val);
                },
        ),
        const Spacer(),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: _isSubmitting ? null : _approve,
            child: _isSubmitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppColors.ink,
                    ),
                  )
                : const Text('AUTORIZAR COM A BIOMETRIA'),
          ),
        ),
      ],
    );
  }
}
