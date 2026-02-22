import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { TasteQuestion } from '@sotto/shared';
import { api } from '../lib/api';
import { SwipeCard } from './SwipeCard';
import { EmptyState } from './EmptyState';

interface InspireSwipeQuizProps {
  questions: TasteQuestion[];
  isLoading: boolean;
  onSelectTopic: (topic: string) => void;
  onLoadMore: () => void;
}

export function InspireSwipeQuiz({
  questions,
  isLoading,
  onSelectTopic,
  onLoadMore,
}: InspireSwipeQuizProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [savedToast, setSavedToast] = useState(false);
  const savedToastTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastScale = useSharedValue(0);

  // Reset index when questions change (new batch loaded)
  useEffect(() => {
    setCurrentIndex(0);
  }, [questions]);

  useEffect(() => {
    return () => {
      if (savedToastTimeout.current) {
        clearTimeout(savedToastTimeout.current);
      }
    };
  }, []);

  // Auto-load more when running low
  useEffect(() => {
    if (questions.length > 0 && questions.length - currentIndex < 2) {
      onLoadMore();
    }
  }, [currentIndex, questions.length, onLoadMore]);

  const advance = useCallback(() => {
    setCurrentIndex((prev) => prev + 1);
  }, []);

  const handleSwipeRight = useCallback(() => {
    const question = questions[currentIndex];
    if (question) {
      onSelectTopic(question.topic);
    }
  }, [questions, currentIndex, onSelectTopic]);

  const handleSwipeLeft = useCallback(() => {
    const question = questions[currentIndex];
    if (question) {
      // Fire-and-forget taste signal
      api.post('/taste-quiz', {
        answers: [{
          questionId: question.id,
          question: question.text,
          tagSlugs: question.tagSlugs,
          response: 'no',
        }],
      }).catch(() => {});
    }
    advance();
  }, [questions, currentIndex, advance]);

  const handleLongPress = useCallback(() => {
    const question = questions[currentIndex];
    if (!question) return;

    api.post('/ideas', {
      questionId: question.id,
      question: question.text,
      tagSlugs: question.tagSlugs,
      category: question.category,
    }).catch(() => {});

    if (savedToastTimeout.current) {
      clearTimeout(savedToastTimeout.current);
    }

    setSavedToast(true);
    toastScale.value = withSequence(
      withTiming(1, { duration: 150 }),
      withTiming(1, { duration: 1200 }),
      withTiming(0, { duration: 200 }),
    );

    savedToastTimeout.current = setTimeout(() => {
      setSavedToast(false);
    }, 1600);
  }, [questions, currentIndex, toastScale]);

  const handleButtonNo = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    handleSwipeLeft();
  }, [handleSwipeLeft]);

  const handleButtonYes = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    handleSwipeRight();
  }, [handleSwipeRight]);

  const handleButtonSave = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    handleLongPress();
  }, [handleLongPress]);

  const toastStyle = useAnimatedStyle(() => ({
    transform: [{ scale: toastScale.value }],
    opacity: toastScale.value,
  }));

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading questions...</Text>
      </View>
    );
  }

  if (questions.length === 0) {
    return (
      <EmptyState
        icon={'\uD83D\uDD2D'}
        title="No questions yet"
        subtitle="Try adjusting the topic filter or check back later."
      />
    );
  }

  const visibleQuestions = questions.slice(currentIndex, currentIndex + 3);

  if (visibleQuestions.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading more...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.deckContainer}>
        {visibleQuestions
          .reverse()
          .map((question, reversedIndex) => {
            const deckIndex = Math.min(2, visibleQuestions.length - 1) - reversedIndex;
            const isActive = deckIndex === 0;

            return (
              <DeckCard
                key={question.id}
                question={question}
                deckIndex={deckIndex}
                isActive={isActive}
                onSwipeRight={handleSwipeRight}
                onSwipeLeft={handleSwipeLeft}
                onLongPress={handleLongPress}
              />
            );
          })}

        {savedToast && (
          <Animated.View style={[styles.savedToast, toastStyle]}>
            <Text style={styles.savedToastText}>
              {'\uD83D\uDD16'} Saved!
            </Text>
          </Animated.View>
        )}
      </View>

      <View style={styles.buttonsRow}>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            styles.noButton,
            pressed && styles.noButtonPressed,
          ]}
          onPress={handleButtonNo}
          accessibilityLabel="Skip"
        >
          <Text style={styles.noButtonIcon}>{'\u2717'}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            styles.saveButton,
            pressed && styles.saveButtonPressed,
          ]}
          onPress={handleButtonSave}
          accessibilityLabel="Save idea"
        >
          <Text style={styles.saveButtonIcon}>{'\uD83D\uDD16'}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            styles.yesButton,
            pressed && styles.yesButtonPressed,
          ]}
          onPress={handleButtonYes}
          accessibilityLabel="Create podcast"
        >
          <Text style={styles.yesButtonIcon}>{'\u2713'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function DeckCard({
  question,
  deckIndex,
  isActive,
  onSwipeRight,
  onSwipeLeft,
  onLongPress,
}: {
  question: TasteQuestion;
  deckIndex: number;
  isActive: boolean;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  onLongPress: () => void;
}) {
  const scale = useSharedValue(1 - deckIndex * 0.05);
  const translateY = useSharedValue(deckIndex * 10);

  const deckStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateY: translateY.value },
    ],
    zIndex: 3 - deckIndex,
  }));

  return (
    <Animated.View style={[styles.deckCardWrapper, deckStyle]}>
      <SwipeCard
        question={question}
        onSwipeRight={onSwipeRight}
        onSwipeLeft={onSwipeLeft}
        onLongPress={onLongPress}
        isActive={isActive}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: spacing.md,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  loadingText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  deckContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deckCardWrapper: {
    position: 'absolute',
    alignItems: 'center',
  },
  savedToast: {
    position: 'absolute',
    bottom: spacing.lg,
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  savedToastText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textInverse,
  },
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.sm,
  },
  actionButton: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  noButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  noButtonPressed: {
    backgroundColor: colors.primaryLighter,
  },
  noButtonIcon: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
  },
  saveButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  saveButtonPressed: {
    backgroundColor: colors.accentLighter,
  },
  saveButtonIcon: {
    fontSize: 18,
  },
  yesButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.success,
  },
  yesButtonPressed: {
    backgroundColor: colors.successLighter,
  },
  yesButtonIcon: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.success,
  },
});
