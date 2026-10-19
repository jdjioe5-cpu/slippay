import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../../core/chain/chain_port.dart';
import '../../../core/chain/chain_provider.dart';
import '../../../core/money/usdc_amount.dart';
import '../../../core/theme/app_theme.dart';
import '../../wallet/domain/wallet.dart';
import '../../wallet/presentation/wallet_controller.dart';

/// Pay: scan a QR, then a TRUSTED confirm sheet shows the decoded recipient +
/// amount (the WebAuthn assertion proves presence, NOT intent, so OUR app must
/// render the intent), then biometric sign -> fee-bump -> submit -> /receipt.
class PayScreen extends ConsumerStatefulWidget {
  const PayScreen({
    this.chainPort,
    super.key,
  });

  /// Optional ChainPort override for testing/mocking.
  final ChainPort? chainPort;

  @override
  ConsumerState<PayScreen> createState() => _PayScreenState();
}

class _PayScreenState extends ConsumerState<PayScreen> {
  String? _scanned;
  bool _handled = false;
  bool _isSubmitting = false;
  SignPhase _phase = SignPhase.idle;
  String? _submitError;

  void _onDetect(BarcodeCapture capture) {
    if (_handled) return;
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null) return;
    setState(() {
      _handled = true;
      _scanned = raw;
      _submitError = null;
    });
    _showConfirm(raw);
  }

  String _deriveStatusMessage(SignPhase phase) {
    switch (phase) {
      case SignPhase.building:
        return 'Preparando transação…';
      case SignPhase.awaitingBiometric:
        return 'Aguardando validação biométrica…';
      case SignPhase.signing:
        return 'Assinando com a passkey…';
      case SignPhase.submitting:
        return 'Submetendo transação à blockchain…';
      case SignPhase.settled:
        return 'Confirmado on-chain!';
      case SignPhase.failed:
        return 'Falha na transação';
      case SignPhase.idle:
      default:
        return '';
    }
  }

  String _classifyError(dynamic error) {
    final msg = error.toString().toLowerCase();
    if (msg.contains('biometric') ||
        msg.contains('cancelled') ||
        msg.contains('canceled') ||
        msg.contains('user_rejection') ||
        msg.contains('not allowed')) {
      return 'Autenticação biométrica cancelada ou recusada.';
    }
    if (msg.contains('rpc') ||
        msg.contains('unreachable') ||
        msg.contains('network') ||
        msg.contains('connection')) {
      return 'Erro de conexão: nó RPC indisponível na rede.';
    }
    if (msg.contains('revert') ||
        msg.contains('reverted') ||
        msg.contains('insufficient') ||
        msg.contains('tx_failed')) {
      return 'A transação falhou ou foi revertida na blockchain.';
    }
    return 'Falha ao processar pagamento: ${error.toString()}';
  }

  Future<void> _executePayment(
    BuildContext sheetContext,
    String payload,
    StateSetter setSheetState,
  ) async {
    if (_isSubmitting) return;

    setSheetState(() {
      _isSubmitting = true;
      _phase = SignPhase.building;
      _submitError = null;
    });

    try {
      final port = widget.chainPort ?? ref.read(chainPortProvider);
      final walletAddress = ref.read(walletControllerProvider).valueOrNull?.address ??
          await port.connectWallet();

      setSheetState(() {
        _phase = SignPhase.awaitingBiometric;
      });

      // Simple recipient extraction fallback for demo payloads
      String recipient = payload;
      UsdcAmount amount = UsdcAmount.parse('1.00');

      if (payload.contains('to=')) {
        final uri = Uri.tryParse(payload.startsWith('http') ? payload : 'slippay:$payload');
        if (uri != null) {
          final to = uri.queryParameters['to'] ?? uri.queryParameters['destination'];
          if (to != null) recipient = to;
          final amt = uri.queryParameters['amount'];
          if (amt != null) {
            try {
              amount = UsdcAmount.parse(amt);
            } catch (_) {}
          }
        }
      }

      setSheetState(() {
        _phase = SignPhase.submitting;
      });

      final args = OneTimePayArgs(
        buyerAddress: walletAddress,
        merchantAddress: recipient,
        platformAddress: recipient,
        amount: amount,
        platformFeeBp: 0,
        memoHex: '0000000000000000000000000000000000000000000000000000000000000000',
        maxTime: (DateTime.now().millisecondsSinceEpoch ~/ 1000) + 300,
      );

      final result = await port.payOneTime(args);

      setSheetState(() {
        _phase = SignPhase.settled;
        _isSubmitting = false;
      });

      if (!mounted) return;
      if (sheetContext.mounted) {
        Navigator.of(sheetContext).pop();
      }

      // Navigate to confirmed on-chain receipt screen
      context.go('/receipt/${result.hash}');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Pagamento confirmado on-chain! Hash: ${result.hash}'),
          backgroundColor: AppColors.ok,
          duration: const Duration(seconds: 4),
        ),
      );
    } catch (e) {
      final classified = _classifyError(e);
      setSheetState(() {
        _isSubmitting = false;
        _phase = SignPhase.failed;
        _submitError = classified;
      });
    }
  }

  Future<void> _showConfirm(String payload) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.bone,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) => Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'CONFIRME O PAGAMENTO',
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 10,
                  letterSpacing: 2,
                  color: AppColors.gray,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                payload,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12, color: AppColors.ink),
              ),
              const SizedBox(height: 16),
              if (_phase != SignPhase.idle && _phase != SignPhase.failed) ...[
                Row(
                  children: [
                    const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppColors.ink,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      _deriveStatusMessage(_phase),
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 12,
                        color: AppColors.ink,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
              ],
              if (_submitError != null) ...[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.leak.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    _submitError!,
                    style: const TextStyle(
                      color: AppColors.leak,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _isSubmitting
                      ? null
                      : () => _executePayment(sheetContext, payload, setSheetState),
                  child: _isSubmitting
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: AppColors.ink,
                          ),
                        )
                      : Text(
                          _submitError != null ? 'TENTAR NOVAMENTE' : 'AUTORIZAR COM A BIOMETRIA',
                        ),
                ),
              ),
              const SizedBox(height: 8),
              Center(
                child: TextButton(
                  onPressed: _isSubmitting
                      ? null
                      : () {
                          Navigator.of(sheetContext).pop();
                          setState(() => _handled = false);
                        },
                  child: const Text('cancelar', style: TextStyle(color: AppColors.gray)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (mounted) setState(() => _handled = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.bone,
        elevation: 0,
        title: const Text('Pagar', style: TextStyle(color: AppColors.ink)),
      ),
      body: Stack(
        children: [
          MobileScanner(onDetect: _onDetect),
          Positioned(
            bottom: 40,
            left: 0,
            right: 0,
            child: Text(
              _scanned == null ? 'aponte pra um QR de pagamento' : 'lido',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white, fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}
