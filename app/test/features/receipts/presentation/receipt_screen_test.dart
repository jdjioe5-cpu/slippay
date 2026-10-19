import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/features/receipts/presentation/receipt_screen.dart';

void main() {
  const testHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  group('ReceiptScreen Explorer Integration', () {
    test('computes explorerUrl accurately with default testnet network', () {
      const screen = ReceiptScreen(txHash: testHash);
      expect(
        screen.explorerUrl,
        'https://stellar.expert/explorer/testnet/tx/$testHash',
      );
    });

    testWidgets('renders confirmation, tx hash and explorer affordances', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: ReceiptScreen(txHash: testHash),
        ),
      );

      expect(find.text('Pago.'), findsOneWidget);
      expect(find.text('Confirmado on-chain. Verificável por qualquer um.'), findsOneWidget);
      expect(find.text(testHash), findsOneWidget);
      expect(find.text('abrir'), findsOneWidget);
      expect(find.byIcon(Icons.open_in_new), findsOneWidget);
      expect(find.text('VER NO EXPLORER'), findsOneWidget);
    });

    testWidgets('tapping VER NO EXPLORER launches the external explorer URL', (tester) async {
      Uri? openedUri;
      await tester.pumpWidget(
        MaterialApp(
          home: ReceiptScreen(
            txHash: testHash,
            openUrl: (uri) async {
              openedUri = uri;
              return true;
            },
          ),
        ),
      );

      await tester.tap(find.text('VER NO EXPLORER'));
      await tester.pumpAndSettle();

      expect(openedUri, isNotNull);
      expect(
        openedUri.toString(),
        'https://stellar.expert/explorer/testnet/tx/$testHash',
      );
    });

    testWidgets('tapping tx hash directly triggers explorer launch', (tester) async {
      Uri? openedUri;
      await tester.pumpWidget(
        MaterialApp(
          home: ReceiptScreen(
            txHash: testHash,
            openUrl: (uri) async {
              openedUri = uri;
              return true;
            },
          ),
        ),
      );

      await tester.tap(find.text(testHash));
      await tester.pumpAndSettle();

      expect(openedUri, isNotNull);
      expect(
        openedUri.toString(),
        'https://stellar.expert/explorer/testnet/tx/$testHash',
      );
    });

    testWidgets('tapping abrir header affordance triggers explorer launch', (tester) async {
      Uri? openedUri;
      await tester.pumpWidget(
        MaterialApp(
          home: ReceiptScreen(
            txHash: testHash,
            openUrl: (uri) async {
              openedUri = uri;
              return true;
            },
          ),
        ),
      );

      await tester.tap(find.text('abrir'));
      await tester.pumpAndSettle();

      expect(openedUri, isNotNull);
      expect(
        openedUri.toString(),
        'https://stellar.expert/explorer/testnet/tx/$testHash',
      );
    });

    testWidgets('falls back to clipboard copy and shows SnackBar when launch returns false', (tester) async {
      String? copiedText;
      await tester.pumpWidget(
        MaterialApp(
          home: ReceiptScreen(
            txHash: testHash,
            openUrl: (uri) async => false,
            copyToClipboard: (text) async {
              copiedText = text;
            },
          ),
        ),
      );

      await tester.tap(find.text('VER NO EXPLORER'));
      await tester.pumpAndSettle();

      expect(
        copiedText,
        'https://stellar.expert/explorer/testnet/tx/$testHash',
      );
      expect(find.text('Link do explorer copiado para a área de transferência.'), findsOneWidget);
    });

    testWidgets('falls back to clipboard copy when launcher throws exception', (tester) async {
      String? copiedText;
      await tester.pumpWidget(
        MaterialApp(
          home: ReceiptScreen(
            txHash: testHash,
            openUrl: (uri) async => throw Exception('Platform launch failed'),
            copyToClipboard: (text) async {
              copiedText = text;
            },
          ),
        ),
      );

      await tester.tap(find.text(testHash));
      await tester.pumpAndSettle();

      expect(
        copiedText,
        'https://stellar.expert/explorer/testnet/tx/$testHash',
      );
      expect(find.text('Link do explorer copiado para a área de transferência.'), findsOneWidget);
    });
  });
}
