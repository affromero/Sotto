import { Text, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <Animated.View entering={FadeIn.duration(500)} style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      {onRetry && (
        <Pressable style={styles.retryButton} onPress={onRetry}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  message: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
  },
  retryButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
