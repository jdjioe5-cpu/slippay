import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/core/money/usdc_amount.dart';

void main() {
  group('UsdcAmount.parse', () {
    test('parses whole dollars to 7-decimal minor units', () {
      expect(UsdcAmount.parse('1').minor, BigInt.from(10000000));
      expect(UsdcAmount.parse('12.50').minor, BigInt.from(125000000));
    });

    test('parses full 7-decimal precision', () {
      expect(UsdcAmount.parse('0.0000001').minor, BigInt.one);
    });

    test('rejects more than 7 decimal places', () {
      expect(() => UsdcAmount.parse('0.00000001'), throwsFormatException);
    });

    test('rejects negative', () {
      expect(() => UsdcAmount.parse('-1'), throwsFormatException);
    });
  });

  group('UsdcAmount.fromMinor', () {
    test('builds from a chain minor-unit string', () {
      expect(UsdcAmount.fromMinor('125000000'), UsdcAmount.parse('12.5'));
    });
  });

  group('toHuman', () {
    test('trims trailing zeros, keeps 2 min', () {
      expect(UsdcAmount.parse('12.50').toHuman(), '12.50');
      expect(UsdcAmount.parse('12.3456700').toHuman(), '12.34567');
      expect(UsdcAmount.parse('1').toHuman(), '1.00');
      expect(UsdcAmount.zero.toHuman(), '0.00');
    });
  });

  group('arithmetic', () {
    test('add/subtract/compare in minor units', () {
      final a = UsdcAmount.parse('10');
      final b = UsdcAmount.parse('2.5');
      expect((a + b).toHuman(), '12.50');
      expect((a - b).toHuman(), '7.50');
      expect(a > b, isTrue);
      expect(b < a, isTrue);
    });

    test('round-trips through minor string with no float drift', () {
      final a = UsdcAmount.parse('0.1') + UsdcAmount.parse('0.2');
      expect(a.toHuman(), '0.30'); // the classic 0.1+0.2 float trap, avoided
      expect(a.toMinorString(), '3000000');
    });

    test('allows exact subtraction to zero', () {
      final a = UsdcAmount.parse('5.00');
      expect((a - a).toHuman(), '0.00');
      expect((a - a) == UsdcAmount.zero, isTrue);
    });

    test('throws ArgumentError on subtraction underflow', () {
      final smaller = UsdcAmount.parse('2.00');
      final larger = UsdcAmount.parse('5.00');
      expect(() => smaller - larger, throwsArgumentError);
    });

    test('clampedSubtract gracefully clamps to zero when underflowing', () {
      final smaller = UsdcAmount.parse('2.00');
      final larger = UsdcAmount.parse('5.00');
      expect(smaller.clampedSubtract(larger), UsdcAmount.zero);
      expect(larger.clampedSubtract(smaller), UsdcAmount.parse('3.00'));
    });
  });

  group('non-negative invariant enforcement', () {
    test('direct constructor rejects negative BigInt', () {
      expect(() => UsdcAmount(BigInt.from(-1)), throwsA(anything));
    });

    test('fromMinor rejects negative string/int', () {
      expect(() => UsdcAmount.fromMinor('-1000000'), throwsFormatException);
      expect(() => UsdcAmount.fromMinor(BigInt.from(-50)), throwsFormatException);
    });
  });
}
