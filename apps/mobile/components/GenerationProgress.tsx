import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { colors, spacing, typography } from '@sotto/shared';

interface GenerationProgressProps {
  status: string;
}

const STEPS = [
  { key: 'EXTRACTING', label: 'Extracting content...' },
  { key: 'SCRIPTING', label: 'Writing script...' },
  { key: 'VERIFYING_SCRIPT', label: 'Fact-checking claims...' },
  { key: 'VALIDATING_REFERENCES', label: 'Validating sources...' },
  { key: 'SCRIPT_READY', label: 'Script ready' },
  { key: 'GENERATING_AUDIO', label: 'Generating audio...' },
  { key: 'STITCHING', label: 'Assembling podcast...' },
  { key: 'READY', label: 'Complete!' },
] as const;

function getStepIndex(status: string): number {
  const index = STEPS.findIndex((s) => s.key === status);
  if (index === -1) return 0;
  return index;
}

function StepDot({
  state,
}: {
  state: 'completed' | 'current' | 'future';
}) {
  const pulseOpacity = useSharedValue(1);

  useEffect(() => {
    if (state === 'current') {
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0.5, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      );
    } else {
      pulseOpacity.value = 1;
    }
  }, [state, pulseOpacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: state === 'current' ? pulseOpacity.value : 1,
  }));

  if (state === 'completed') {
    return (
      <View style={[styles.dot, styles.dotCompleted]}>
        <Text style={styles.checkmark}>{'\u2713'}</Text>
      </View>
    );
  }

  if (state === 'current') {
    return (
      <Animated.View style={[styles.dot, styles.dotCurrent, animatedStyle]}>
        <View />
      </Animated.View>
    );
  }

  return <View style={[styles.dot, styles.dotFuture]} />;
}

export function GenerationProgress({ status }: GenerationProgressProps) {
  const currentIndex = getStepIndex(status);
  const fillWidth = useSharedValue(0);

  useEffect(() => {
    const target = STEPS.length > 1 ? (currentIndex / (STEPS.length - 1)) * 100 : 0;
    fillWidth.value = withTiming(target, { duration: 600, easing: Easing.out(Easing.ease) });
  }, [currentIndex, fillWidth]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fillWidth.value}%` as `${number}%`,
  }));

  return (
    <View style={styles.container}>
      <View style={styles.dotsRow}>
        <View style={styles.trackLine} />
        <Animated.View style={[styles.fillLine, fillStyle]} />
        {STEPS.map((step, index) => (
          <StepDot
            key={step.key}
            state={
              index < currentIndex
                ? 'completed'
                : index === currentIndex
                  ? 'current'
                  : 'future'
            }
          />
        ))}
      </View>
      <Text style={styles.stepLabel}>{STEPS[currentIndex].label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    position: 'relative',
  },
  trackLine: {
    position: 'absolute',
    top: 11,
    left: 12,
    right: 12,
    height: 2,
    backgroundColor: colors.border,
  },
  fillLine: {
    position: 'absolute',
    top: 11,
    left: 12,
    height: 2,
    backgroundColor: colors.primary,
  },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  dotCompleted: {
    backgroundColor: colors.primary,
  },
  dotCurrent: {
    backgroundColor: colors.primary,
  },
  dotFuture: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
  },
  checkmark: {
    fontSize: 12,
    color: colors.textInverse,
    fontWeight: '700',
  },
  stepLabel: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
