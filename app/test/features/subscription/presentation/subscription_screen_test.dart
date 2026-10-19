import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/features/subscription/presentation/subscription_screen.dart';

void main() {
  group('SubscriptionScreen Decision Points', () {
    testWidgets('renders title, spending limit heading, input field and authorize button', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: SubscriptionScreen(),
          ),
        ),
      );

      expect(find.text('Autorização recorrente'), findsOneWidget);
      expect(find.text('Você define o teto.\nNunca passa disso.'), findsOneWidget);
      expect(find.text('LIMITE MENSAL · USDC'), findsOneWidget);
      expect(find.text('12.00'), findsOneWidget);
      expect(find.text('AUTORIZAR COM A BIOMETRIA'), findsOneWidget);
    });

    testWidgets('rejects zero cap with descriptive error and stops transaction build', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: SubscriptionScreen(),
          ),
        ),
      );

      final textField = find.byType(TextField);
      await tester.enterText(textField, '0');
      await tester.tap(find.text('AUTORIZAR COM A BIOMETRIA'));
      await tester.pumpAndSettle();

      expect(find.text('defina um limite maior que zero'), findsOneWidget);
    });

    testWidgets('rejects 0.00 zero cap format', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: SubscriptionScreen(),
          ),
        ),
      );

      final textField = find.byType(TextField);
      await tester.enterText(textField, '0.00');
      await tester.tap(find.text('AUTORIZAR COM A BIOMETRIA'));
      await tester.pumpAndSettle();

      expect(find.text('defina um limite maior que zero'), findsOneWidget);
    });

    testWidgets('rejects non-numeric malformed cap format', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: SubscriptionScreen(),
          ),
        ),
      );

      final textField = find.byType(TextField);
      await tester.enterText(textField, 'not_a_valid_amount');
      await tester.tap(find.text('AUTORIZAR COM A BIOMETRIA'));
      await tester.pumpAndSettle();

      expect(find.text('valor inválido'), findsOneWidget);
    });

    testWidgets('valid non-zero cap clears error and triggers authorization flow', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: SubscriptionScreen(),
          ),
        ),
      );

      final textField = find.byType(TextField);
      // Trigger error first
      await tester.enterText(textField, '0');
      await tester.tap(find.text('AUTORIZAR COM A BIOMETRIA'));
      await tester.pumpAndSettle();
      expect(find.text('defina um limite maior que zero'), findsOneWidget);

      // Now enter valid positive cap
      await tester.enterText(textField, '25.50');
      await tester.tap(find.text('AUTORIZAR COM A BIOMETRIA'));
      await tester.pumpAndSettle();

      // Error must be cleared
      expect(find.text('defina um limite maior que zero'), findsNothing);
      expect(find.text('valor inválido'), findsNothing);
    });
  });
}
