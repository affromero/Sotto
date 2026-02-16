import { useCallback } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { TasteQuestion } from '@sotto/shared';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = 120;
const FLY_OUT_X = SCREEN_WIDTH * 1.5;

interface SwipeCardProps {
  question: TasteQuestion;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  onLongPress: () => void;
  isActive: boolean;
}

export function SwipeCard({
  question,
  onSwipeRight,
  onSwipeLeft,
  onLongPress,
  isActive,
}: SwipeCardProps) {
  const translateX = useSharedValue(0);
  const savedScale = useSharedValue(1);

  const handleSwipeRight = useCallback(() => {
    onSwipeRight();
  }, [onSwipeRight]);

  const handleSwipeLeft = useCallback(() => {
    onSwipeLeft();
  }, [onSwipeLeft]);

  const handleLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onLongPress();
  }, [onLongPress]);

  const panGesture = Gesture.Pan()
    .enabled(isActive)
    .onUpdate((event) => {
      translateX.value = event.translationX;
    })
    .onEnd((event) => {
      if (event.translationX > SWIPE_THRESHOLD) {
        translateX.value = withSpring(FLY_OUT_X, { damping: 15, stiffness: 100 }, () => {
          runOnJS(handleSwipeRight)();
        });
      } else if (event.translationX < -SWIPE_THRESHOLD) {
        translateX.value = withSpring(-FLY_OUT_X, { damping: 15, stiffness: 100 }, () => {
          runOnJS(handleSwipeLeft)();
        });
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  const longPressGesture = Gesture.LongPress()
    .enabled(isActive)
    .minDuration(500)
    .onStart(() => {
      savedScale.value = withSequence(
        withTiming(1.05, { duration: 100 }),
        withTiming(1, { duration: 150 }),
      );
      runOnJS(handleLongPress)();
    });

  const composedGesture = Gesture.Race(panGesture, longPressGesture);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { rotate: `${interpolate(translateX.value, [-SCREEN_WIDTH, 0, SCREEN_WIDTH], [-15, 0, 15])}deg` },
      { scale: savedScale.value },
    ],
  }));

  const yesOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD], [0, 1], 'clamp'),
  }));

  const noOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-SWIPE_THRESHOLD, 0], [1, 0], 'clamp'),
  }));

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View style={[styles.card, cardStyle]}>
        <Animated.View style={[styles.overlay, styles.yesOverlay, yesOverlayStyle]}>
          <Text style={styles.yesLabel}>YES</Text>
        </Animated.View>
        <Animated.View style={[styles.overlay, styles.noOverlay, noOverlayStyle]}>
          <Text style={styles.noLabel}>NO</Text>
        </Animated.View>

        <View style={styles.categoryBadge}>
          <Text style={styles.categoryText}>{question.category}</Text>
        </View>

        <Text style={styles.questionText}>{question.text}</Text>

        <View style={styles.tagsRow}>
          {question.tagSlugs.slice(0, 3).map((tag) => (
            <View key={tag} style={styles.tagChip}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: {
    width: SCREEN_WIDTH - spacing.lg * 2,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 320,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  overlay: {
    position: 'absolute',
    top: spacing.lg,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 2,
  },
  yesOverlay: {
    right: spacing.lg,
    borderColor: colors.success,
    backgroundColor: colors.successLighter,
  },
  noOverlay: {
    left: spacing.lg,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLighter,
  },
  yesLabel: {
    fontFamily: typography.fontBody,
    fontSize: 18,
    fontWeight: '800',
    color: colors.success,
    letterSpacing: 1,
  },
  noLabel: {
    fontFamily: typography.fontBody,
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 1,
  },
  categoryBadge: {
    backgroundColor: colors.accentLighter,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: borderRadius.full,
    marginBottom: spacing.lg,
  },
  categoryText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  questionText: {
    fontFamily: typography.fontHeading,
    fontSize: 24,
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 34,
    marginBottom: spacing.lg,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  tagChip: {
    backgroundColor: colors.primaryLighter,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
  },
  tagText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.primary,
  },
});
