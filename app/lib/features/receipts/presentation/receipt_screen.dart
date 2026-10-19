import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/config/app_config.dart';
import '../../../core/theme/app_theme.dart';

/// On-chain receipt for a settled payment. Mirrors web Comprovante.tsx. The tx
/// hash links to the public explorer: the proof is the chain, not our word.
class ReceiptScreen extends StatelessWidget {
  const ReceiptScreen({
    required this.txHash,
    this.openUrl,
    this.copyToClipboard,
    super.key,
  });

  final String txHash;
  final Future<bool> Function(Uri uri)? openUrl;
  final Future<void> Function(String text)? copyToClipboard;

  String get _explorerUrl {
    final net = AppConfig.stellarNetwork == 'PUBLIC' ? 'public' : 'testnet';
    return 'https://stellar.expert/explorer/$net/tx/$txHash';
  }

  String get explorerUrl => _explorerUrl;

  Future<void> _openExplorer(BuildContext context) async {
    final uri = Uri.parse(_explorerUrl);
    var launched = false;
    try {
      if (openUrl != null) {
        launched = await openUrl!(uri);
      } else {
        if (await canLaunchUrl(uri)) {
          launched = await launchUrl(
            uri,
            mode: LaunchMode.externalApplication,
          );
        }
      }
    } catch (_) {
      launched = false;
    }

    if (!launched && context.mounted) {
      if (copyToClipboard != null) {
        await copyToClipboard!(_explorerUrl);
      } else {
        await Clipboard.setData(ClipboardData(text: _explorerUrl));
      }
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Link do explorer copiado para a área de transferência.'),
            duration: Duration(seconds: 3),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.bone,
        elevation: 0,
        title: const Text('Comprovante', style: TextStyle(color: AppColors.ink)),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              const SizedBox(height: 24),
              const Icon(Icons.check_circle, size: 72, color: AppColors.ok),
              const SizedBox(height: 16),
              const Text(
                'Pago.',
                style: TextStyle(fontSize: 32, fontWeight: FontWeight.w900, color: AppColors.ink),
              ),
              const SizedBox(height: 8),
              const Text(
                'Confirmado on-chain. Verificável por qualquer um.',
                style: TextStyle(fontSize: 15, color: AppColors.gray),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 32),
              _field(
                context,
                label: 'TX HASH',
                value: txHash,
                onTap: () {
                  unawaited(_openExplorer(context));
                },
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    unawaited(_openExplorer(context));
                  },
                  child: const Text('VER NO EXPLORER'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _field(
    BuildContext context, {
    required String label,
    required String value,
    VoidCallback? onTap,
  }) =>
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
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
              if (onTap != null)
                InkWell(
                  onTap: onTap,
                  borderRadius: BorderRadius.circular(4),
                  child: const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'abrir',
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 10,
                            letterSpacing: 1,
                            color: AppColors.gray,
                            decoration: TextDecoration.underline,
                          ),
                        ),
                        SizedBox(width: 4),
                        Icon(Icons.open_in_new, size: 12, color: AppColors.gray),
                      ],
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          SelectableText(
            value,
            onTap: onTap,
            style: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 12,
              color: AppColors.ink,
            ),
          ),
        ],
      );
}
