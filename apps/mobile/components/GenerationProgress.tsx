import { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  FadeIn,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, STAGE_MESSAGES, resolveMessage } from '@sotto/shared';

const CYCLE_INTERVAL_MS = 9_000;
const LATE_THRESHOLD_MS = 120_000;

interface GenerationProgressProps {
  status: string;
  topic?: string;
}

const STEPS = [
  { key: 'EXTRACTING', label: 'Extracting content...' },
  { key: 'RESEARCHING', label: 'Researching the topic...' },
  { key: 'PLANNING', label: 'Planning the narrative...' },
  { key: 'SCRIPTING', label: 'Writing script...' },
  { key: 'COMPILING', label: 'Verifying citations...' },
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
        <Ionicons name="checkmark" size={12} color={colors.textInverse} />
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

export function GenerationProgress({ status, topic }: GenerationProgressProps) {
  const currentIndex = getStepIndex(status);
  const fillWidth = useSharedValue(0);
  const [subMessage, setSubMessage] = useState<string | null>(null);
  const [messageKey, setMessageKey] = useState(0);
  const stageStartRef = useRef<number>(Date.now());
  const indexRef = useRef(0);
  const prevStatusRef = useRef(status);

  const isActive = status !== 'SCRIPT_READY' && status !== 'READY';

  // Reset on status change
  useEffect(() => {
    if (prevStatusRef.current !== status) {
      stageStartRef.current = Date.now();
      indexRef.current = 0;
      prevStatusRef.current = status;
    }
  }, [status]);

  const pickMessage = useCallback(() => {
    const pool = STAGE_MESSAGES[status];
    if (!pool) return null;
    const elapsed = Date.now() - stageStartRef.current;
    const messages = elapsed >= LATE_THRESHOLD_MS ? pool.late : pool.early;
    if (messages.length === 0) return null;
    const idx = indexRef.current % messages.length;
    indexRef.current = idx + 1;
    return resolveMessage(messages[idx], topic);
  }, [status, topic]);

  useEffect(() => {
    if (!isActive) {
      setSubMessage(null);
      return;
    }
    const first = pickMessage();
    setSubMessage(first);
    setMessageKey((k) => k + 1);

    const interval = setInterval(() => {
      const next = pickMessage();
      setSubMessage(next);
      setMessageKey((k) => k + 1);
    }, CYCLE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isActive, pickMessage]);

  useEffect(() => {
    const target = STEPS.length > 1 ? (currentIndex / (STEPS.length - 1)) * 100 : 0;
    fillWidth.value = withTiming(target, { duration: 600, easing: Easing.out(Easing.ease) });
  }, [currentIndex, fillWidth]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fillWidth.value}%` as `${number}%`,
  }));

  return (
    <View style={styles.container} testID="generation-progress">
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
      {subMessage && (
        <Animated.Text
          key={messageKey}
          entering={FadeIn.duration(500)}
          style={styles.subMessage}
          accessibilityLiveRegion="polite"
        >
          {subMessage}
        </Animated.Text>
      )}
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
  subMessage: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 280,
    alignSelf: 'center',
    lineHeight: 18,
  },
});
