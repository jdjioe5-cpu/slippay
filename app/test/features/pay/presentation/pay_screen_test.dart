import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:slippay/features/pay/presentation/pay_screen.dart';

void main() {
  group('PayScreen Widget and State Tests', () {
    testWidgets('renders mobile scanner and scan instruction hint', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: PayScreen(),
          ),
        ),
      );

      expect(find.text('Pagar'), findsOneWidget);
      expect(find.byType(MobileScanner), findsOneWidget);
      expect(find.text('aponte pra um QR de pagamento'), findsOneWidget);
    });

    testWidgets('triggers confirmation bottom sheet upon detecting scanned payload', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: PayScreen(),
          ),
        ),
      );

      final scanner = tester.widget<MobileScanner>(find.byType(MobileScanner));
      expect(scanner.onDetect, isNotNull);

      // Simulate a scanned barcode event
      const testPayload = 'web+stellar:pay?destination=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5&amount=10';
      scanner.onDetect!(
        const BarcodeCapture(
          barcodes: [
            Barcode(rawValue: testPayload),
          ],
        ),
      );

      await tester.pumpAndSettle();

      // Verify confirmation bottom sheet is displayed
      expect(find.text('CONFIRME O PAGAMENTO'), findsOneWidget);
      expect(find.text(testPayload), findsOneWidget);
      expect(find.text('AUTORIZAR COM A BIOMETRIA'), findsOneWidget);
      expect(find.text('cancelar'), findsOneWidget);

      // Tap cancel to dismiss
      await tester.tap(find.text('cancelar'));
      await tester.pumpAndSettle();

      expect(find.text('CONFIRME O PAGAMENTO'), findsNothing);
    });

    testWidgets('tapping authorize button displays pending confirmation status', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: PayScreen(),
          ),
        ),
      );

      final scanner = tester.widget<MobileScanner>(find.byType(MobileScanner));
      scanner.onDetect!(
        const BarcodeCapture(
          barcodes: [
            Barcode(rawValue: 'test_destination_123'),
          ],
        ),
      );

      await tester.pumpAndSettle();

      await tester.tap(find.text('AUTORIZAR COM A BIOMETRIA'));
      await tester.pumpAndSettle();

      expect(find.text('CONFIRME O PAGAMENTO'), findsNothing);
      expect(find.text('assinatura on-chain: pendente do chain adapter'), findsOneWidget);
    });
  });
}
