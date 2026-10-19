import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/core/router/app_router.dart';
import 'package:slippay/features/wallet/presentation/wallet_controller.dart';

void main() {
  group('Router Guard and RefreshListenable', () {
    test('RouterRefreshNotifier triggers notification on connection transition', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final notifier = container.read(routerRefreshNotifierProvider);
      var notificationCount = 0;
      notifier.addListener(() {
        notificationCount++;
      });

      // Initially disconnected
      expect(container.read(isConnectedProvider), isFalse);

      // Trigger connect
      container.read(walletControllerProvider.notifier).connect();
      expect(notificationCount, greaterThanOrEqualTo(1));

      // Trigger disconnect
      final countBeforeDisconnect = notificationCount;
      container.read(walletControllerProvider.notifier).disconnect();
      expect(notificationCount, greaterThan(countBeforeDisconnect));
    });

    testWidgets('Connecting at /onboarding navigates to home route /balance', (tester) async {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: Consumer(
            builder: (context, ref, _) {
              final router = ref.watch(routerProvider);
              return MaterialApp.router(routerConfig: router);
            },
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Initially on /onboarding
      final router = container.read(routerProvider);
      expect(router.state.matchedLocation, equals('/onboarding'));

      // Connect wallet
      await container.read(walletControllerProvider.notifier).connect();
      await tester.pumpAndSettle();

      // Guard reacts automatically to wallet connection and navigates to /balance
      expect(container.read(routerProvider).state.matchedLocation, equals('/balance'));
    });

    testWidgets('Disconnecting on authenticated route navigates to /onboarding without manual navigation', (tester) async {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      // Connect first so we boot authenticated
      await container.read(walletControllerProvider.notifier).connect();

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: Consumer(
            builder: (context, ref, _) {
              final router = ref.watch(routerProvider);
              return MaterialApp.router(routerConfig: router);
            },
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Verify we are at /balance
      expect(container.read(routerProvider).state.matchedLocation, equals('/balance'));

      // Disconnect wallet
      await container.read(walletControllerProvider.notifier).disconnect();
      await tester.pumpAndSettle();

      // Guard reacts automatically and navigates to /onboarding
      expect(container.read(routerProvider).state.matchedLocation, equals('/onboarding'));
    });
  });
}
