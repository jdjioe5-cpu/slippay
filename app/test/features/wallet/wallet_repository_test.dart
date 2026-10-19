import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/features/wallet/data/wallet_repository.dart';
import 'package:slippay/features/wallet/domain/wallet.dart';

void main() {
  group('StubWalletRepository & Wallet domain', () {
    late StubWalletRepository repo;

    setUp(() {
      repo = StubWalletRepository();
    });

    test('initial current wallet is null', () {
      expect(repo.current, isNull);
    });

    test('connect without existing wallet returns Left(WalletError)', () async {
      final res = await repo.connect();
      expect(res.isLeft(), isTrue);
      res.match(
        (err) => expect(err.message, contains('no wallet on this device')),
        (w) => fail('expected Left'),
      );
      expect(repo.current, isNull);
    });

    test('create creates a wallet and saves to current', () async {
      final res = await repo.create();
      expect(res.isRight(), isTrue);
      res.match(
        (err) => fail('expected Right'),
        (wallet) {
          expect(wallet.address, equals('C_STUB_NOT_A_REAL_ACCOUNT'));
          expect(wallet.credentialId, equals('stub-credential'));
          expect(wallet.deployed, isFalse);
        },
      );
      expect(repo.current, isNotNull);
    });

    test('connect returns Right when wallet was previously created', () async {
      await repo.create();
      final res = await repo.connect();
      expect(res.isRight(), isTrue);
      expect(repo.current?.address, equals('C_STUB_NOT_A_REAL_ACCOUNT'));
    });

    test('disconnect clears current wallet', () async {
      await repo.create();
      expect(repo.current, isNotNull);

      await repo.disconnect();
      expect(repo.current, isNull);
    });

    test('Wallet.copyWith copies and overrides fields', () {
      const original = Wallet(
        address: 'C_ADDR',
        credentialId: 'cred_1',
        deployed: false,
      );

      final updated = original.copyWith(deployed: true);
      expect(updated.address, equals('C_ADDR'));
      expect(updated.credentialId, equals('cred_1'));
      expect(updated.deployed, isTrue);

      final newAddr = original.copyWith(address: 'C_NEW');
      expect(newAddr.address, equals('C_NEW'));
      expect(newAddr.credentialId, equals('cred_1'));
    });

    test('WalletError toString includes message', () {
      const err = WalletError('biometric rejected');
      expect(err.toString(), contains('biometric rejected'));
    });
  });
}
