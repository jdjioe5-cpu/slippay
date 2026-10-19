import 'package:flutter_test/flutter_test.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:slippay/core/observability/crash_report_scrubber.dart';

void main() {
  group('CrashReportScrubber.scrubText', () {
    test('scrubs Stellar secret keys', () {
      const secret = 'SBBKIN4ZQWJUND63GSFEXLKZFLXZ3J265FPGYKPLGXA34QYSAFFC3C5X';
      final text = 'Critical error with key: $secret during auth';
      final scrubbed = CrashReportScrubber.scrubText(text);
      expect(scrubbed.contains(secret), isFalse);
      expect(scrubbed, contains('[SCRUBBED_SECRET_KEY]'));
    });

    test('scrubs Stellar public addresses and contract IDs', () {
      const pubkey = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
      final text = 'Failed payment for address: $pubkey';
      final scrubbed = CrashReportScrubber.scrubText(text);
      expect(scrubbed.contains(pubkey), isFalse);
      expect(scrubbed, contains('[SCRUBBED_STELLAR_ADDRESS]'));
    });

    test('scrubs 32-byte (64 hex character) transaction hashes', () {
      const txHash = '1a5be20c13177328dc5567ad7e10c94349de02de4f796a32d18476839210abcd';
      final text = 'Tx timeout for hash: $txHash';
      final scrubbed = CrashReportScrubber.scrubText(text);
      expect(scrubbed.contains(txHash), isFalse);
      expect(scrubbed, contains('[SCRUBBED_TX_HASH]'));
    });

    test('scrubs Bearer tokens and Authorization headers', () {
      const auth = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.secret';
      final text = 'Request failed: $auth';
      final scrubbed = CrashReportScrubber.scrubText(text);
      expect(scrubbed.contains('eyJhbGci'), isFalse);
      expect(scrubbed, contains('Bearer [SCRUBBED_TOKEN]'));
    });

    test('scrubs Brazilian CPF and CNPJ', () {
      const cpf = '123.456.789-00';
      const cnpj = '12.345.678/0001-99';
      final text = 'Buyer details: CPF $cpf, CNPJ $cnpj';
      final scrubbed = CrashReportScrubber.scrubText(text);
      expect(scrubbed.contains(cpf), isFalse);
      expect(scrubbed.contains(cnpj), isFalse);
      expect(scrubbed, contains('[SCRUBBED_CPF]'));
      expect(scrubbed, contains('[SCRUBBED_CNPJ]'));
    });

    test('scrubs email addresses and phone numbers', () {
      const email = 'user.checkout@example.com';
      const phone = '+55 11 98765-4321';
      final text = 'Contact: $email or $phone';
      final scrubbed = CrashReportScrubber.scrubText(text);
      expect(scrubbed.contains(email), isFalse);
      expect(scrubbed.contains('98765-4321'), isFalse);
      expect(scrubbed, contains('[SCRUBBED_EMAIL]'));
      expect(scrubbed, contains('[SCRUBBED_PHONE]'));
    });

    test('preserves generic error messages without sensitive data', () {
      const msg = 'Network connection timeout while connecting to RPC';
      expect(CrashReportScrubber.scrubText(msg), equals(msg));
    });
  });

  group('CrashReportScrubber.scrubEvent', () {
    test('strips user identity and scrubs message and exceptions', () {
      final event = SentryEvent(
        message: const SentryMessage('Error with hash 1a5be20c13177328dc5567ad7e10c94349de02de4f796a32d18476839210abcd'),
        exceptions: [
          const SentryException(
            type: 'AuthException',
            value: 'Failed key SBBKIN4ZQWJUND63GSFEXLKZFLXZ3J265FPGYKPLGXA34QYSAFFC3C5X',
          ),
        ],
        breadcrumbs: [
          Breadcrumb(message: 'User email is buyer@slippay.cc'),
        ],
        extra: {'account': 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'},
        user: SentryUser(id: '123', email: 'test@example.com', ipAddress: '192.168.1.1'),
      );

      final scrubbed = CrashReportScrubber.scrubEvent(event);

      // User must be null (never leak user identity)
      expect(scrubbed.user, isNull);
      expect(scrubbed.message?.formatted, contains('[SCRUBBED_TX_HASH]'));
      expect(scrubbed.exceptions?.first.value, contains('[SCRUBBED_SECRET_KEY]'));
      expect(scrubbed.breadcrumbs?.first.message, contains('[SCRUBBED_EMAIL]'));
      expect(scrubbed.extra?['account'], contains('[SCRUBBED_STELLAR_ADDRESS]'));
    });
  });
}
