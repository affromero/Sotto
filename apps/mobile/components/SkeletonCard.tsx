import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { colors, borderRadius, spacing } from '@sotto/shared';
import { shadowSm } from '../lib/shadows';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

function ShimmerOverlay() {
  const translateX = useSharedValue(-1);

  useEffect(() => {
    translateX.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      false,
    );
  }, [translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value * 200 }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <AnimatedLinearGradient
        colors={[colors.border, colors.surfaceHover, colors.border]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[StyleSheet.absoluteFill, animatedStyle, { width: '150%' }]}
      />
    </Animated.View>
  );
}

interface SkeletonCardProps {
  variant?: 'feed' | 'compact';
}

export function SkeletonCard({ variant = 'feed' }: SkeletonCardProps) {
  if (variant === 'compact') {
    return (
      <View style={styles.compact}>
        <View style={styles.compactThumb}>
          <ShimmerOverlay />
        </View>
        <View style={styles.compactBody}>
          <View style={styles.compactTitle}>
            <ShimmerOverlay />
          </View>
          <View style={styles.compactSubtitle}>
            <ShimmerOverlay />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.feed}>
      <View style={styles.feedCover}>
        <ShimmerOverlay />
      </View>
      <View style={styles.feedBody}>
        <View style={styles.feedTitle}>
          <ShimmerOverlay />
        </View>
        <View style={styles.feedMeta}>
          <ShimmerOverlay />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  feed: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    ...shadowSm,
  },
  feedCover: {
    height: 180,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  feedBody: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  feedTitle: {
    height: 18,
    width: '70%',
    backgroundColor: colors.border,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  feedMeta: {
    height: 14,
    width: '40%',
    backgroundColor: colors.border,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    ...shadowSm,
  },
  compactThumb: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  compactBody: {
    flex: 1,
    gap: spacing.xs,
  },
  compactTitle: {
    height: 16,
    width: '60%',
    backgroundColor: colors.border,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  compactSubtitle: {
    height: 12,
    width: '35%',
    backgroundColor: colors.border,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
});
