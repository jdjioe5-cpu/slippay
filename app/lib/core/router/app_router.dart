import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/wallet/presentation/wallet_controller.dart';
import '../../features/wallet/presentation/onboarding_screen.dart';
import '../../features/balance/presentation/balance_screen.dart';
import '../../features/receive/presentation/receive_screen.dart';
import '../../features/pay/presentation/pay_screen.dart';
import '../../features/receipts/presentation/receipt_screen.dart';
import '../../features/subscription/presentation/subscription_screen.dart';
import '../../features/charge/presentation/charge_screen.dart';
import '../../features/wallet/presentation/account_screen.dart';

/// Listenable that notifies GoRouter when wallet connection state changes.
class RouterRefreshNotifier extends ChangeNotifier {
  RouterRefreshNotifier(Ref ref) {
    ref.listen<bool>(isConnectedProvider, (previous, next) {
      if (previous != next) {
        notifyListeners();
      }
    });
  }
}

final routerRefreshNotifierProvider = Provider<RouterRefreshNotifier>((ref) {
  final notifier = RouterRefreshNotifier(ref);
  ref.onDispose(notifier.dispose);
  return notifier;
});

/// Routes guarded by wallet-connected state. Onboarding when no wallet; the home
/// (balance) once connected. Deep links (Pix QR / payment request) land here too.
final routerProvider = Provider<GoRouter>((ref) {
  final refreshListenable = ref.watch(routerRefreshNotifierProvider);
  final isConnected = ref.watch(isConnectedProvider);

  final router = GoRouter(
    initialLocation: isConnected ? '/balance' : '/onboarding',
    refreshListenable: refreshListenable,
    redirect: (context, state) {
      final connected = ref.read(isConnectedProvider);
      final atOnboarding = state.matchedLocation == '/onboarding';
      if (!connected && !atOnboarding) return '/onboarding';
      if (connected && atOnboarding) return '/balance';
      return null;
    },
    routes: [
      GoRoute(
        path: '/onboarding',
        builder: (_, __) => const OnboardingScreen(),
      ),
      GoRoute(
        path: '/balance',
        builder: (_, __) => const BalanceScreen(),
      ),
      GoRoute(
        path: '/receive',
        builder: (_, __) => const ReceiveScreen(),
      ),
      GoRoute(
        path: '/pay',
        builder: (_, __) => const PayScreen(),
      ),
      GoRoute(
        path: '/charge',
        builder: (_, __) => const ChargeScreen(),
      ),
      GoRoute(
        path: '/subscription',
        builder: (_, __) => const SubscriptionScreen(),
      ),
      GoRoute(
        path: '/account',
        builder: (_, __) => const AccountScreen(),
      ),
      GoRoute(
        path: '/receipt/:hash',
        builder: (_, state) => ReceiptScreen(txHash: state.pathParameters['hash'] ?? ''),
      ),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});
