import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fpdart/fpdart.dart';
import 'package:slippay/features/wallet/data/wallet_repository.dart';
import 'package:slippay/features/wallet/domain/wallet.dart';
import 'package:slippay/features/wallet/presentation/wallet_controller.dart';

class FailingWalletRepository implements WalletRepository {
  @override
  Wallet? get current => null;

  @override
  Future<Either<WalletError, Wallet>> create() async {
    return const Left(WalletError('hardware security module unavailable'));
  }

  @override
  Future<Either<WalletError, Wallet>> connect() async {
    return const Left(WalletError('user cancelled Face ID'));
  }

  @override
  Future<void> disconnect() async {}
}

void main() {
  group('WalletController & isConnectedProvider state machine', () {
    test('initial state has no wallet and isConnectedProvider is false', () async {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final state = await container.read(walletControllerProvider.future);
      expect(state, isNull);
      expect(container.read(isConnectedProvider), isFalse);
    });

    test('create transitions state to data(wallet) and isConnectedProvider to true', () async {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final controller = container.read(walletControllerProvider.notifier);
      await controller.create();

      final state = container.read(walletControllerProvider);
      expect(state.hasValue, isTrue);
      expect(state.value?.address, equals('C_STUB_NOT_A_REAL_ACCOUNT'));
      expect(container.read(isConnectedProvider), isTrue);
    });

    test('connect transitions state to data(wallet) after creation', () async {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final controller = container.read(walletControllerProvider.notifier);
      // Create first
      await controller.create();
      // Disconnect
      await controller.disconnect();
      expect(container.read(isConnectedProvider), isFalse);

      // Re-connect
      await controller.connect();
      expect(container.read(isConnectedProvider), isTrue);
      expect(container.read(walletControllerProvider).value?.credentialId, equals('stub-credential'));
    });

    test('connect error transitions state to AsyncError and isConnectedProvider remains false', () async {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final controller = container.read(walletControllerProvider.notifier);
      // Connect without existing wallet fails
      await controller.connect();

      final state = container.read(walletControllerProvider);
      expect(state.hasError, isTrue);
      expect(state.error, isA<WalletError>());
      expect((state.error as WalletError).message, contains('no wallet on this device'));
      expect(container.read(isConnectedProvider), isFalse);
    });

    test('failing repository causes create and connect to yield AsyncError', () async {
      final container = ProviderContainer(
        overrides: [
          walletRepositoryProvider.overrideWithValue(FailingWalletRepository()),
        ],
      );
      addTearDown(container.dispose);

      final controller = container.read(walletControllerProvider.notifier);

      await controller.create();
      var state = container.read(walletControllerProvider);
      expect(state.hasError, isTrue);
      expect((state.error as WalletError).message, equals('hardware security module unavailable'));
      expect(container.read(isConnectedProvider), isFalse);

      await controller.connect();
      state = container.read(walletControllerProvider);
      expect(state.hasError, isTrue);
      expect((state.error as WalletError).message, equals('user cancelled Face ID'));
      expect(container.read(isConnectedProvider), isFalse);
    });

    test('disconnect clears state and emits null', () async {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final controller = container.read(walletControllerProvider.notifier);
      await controller.create();
      expect(container.read(isConnectedProvider), isTrue);

      await controller.disconnect();
      expect(container.read(isConnectedProvider), isFalse);
      expect(container.read(walletControllerProvider).value, isNull);
    });
  });
}
