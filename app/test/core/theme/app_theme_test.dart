import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:slippay/core/theme/app_theme.dart';

void main() {
  group('AppTheme and AppColors', () {
    test('AppColors matches design tokens', () {
      expect(AppColors.bone, equals(const Color(0xFFF1EEE7)));
      expect(AppColors.bone2, equals(const Color(0xFFF5F3EE)));
      expect(AppColors.ink, equals(const Color(0xFF0A0A0A)));
      expect(AppColors.gold, equals(const Color(0xFFFDDA24)));
      expect(AppColors.gray, equals(const Color(0xFF6F6862)));
      expect(AppColors.ok, equals(const Color(0xFF1F7A4D)));
      expect(AppColors.leak, equals(const Color(0xFFB4402F)));
    });

    test('AppTheme.light builds expected typography and colors', () {
      final theme = AppTheme.light;
      expect(theme.scaffoldBackgroundColor, equals(AppColors.bone));
      expect(theme.colorScheme.primary, equals(AppColors.ink));
      expect(theme.colorScheme.secondary, equals(AppColors.gold));
      expect(theme.colorScheme.surface, equals(AppColors.bone));
      expect(theme.colorScheme.onSurface, equals(AppColors.ink));

      final buttonStyle = theme.filledButtonTheme.style;
      expect(buttonStyle?.backgroundColor?.resolve({}), equals(AppColors.gold));
      expect(buttonStyle?.foregroundColor?.resolve({}), equals(AppColors.ink));
    });
  });
}
