import { StyleSheet } from 'react-native';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';

// Re-export shared tokens for convenience
export { colors, spacing, typography, borderRadius };

// RN-specific style helpers
export const globalStyles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  heading: {
    fontFamily: typography.fontHeading,
    fontSize: 28,
    color: colors.textPrimary,
  },
  body: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  caption: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textSecondary,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    alignItems: 'center' as const,
  },
  primaryButtonText: {
    color: colors.textInverse,
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600' as const,
  },
});
