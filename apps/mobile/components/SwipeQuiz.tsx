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
  withTiming,
  withSequence,
  FadeIn,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { TasteQuestion, TasteAnswer } from '@sotto/shared';
import { api } from '../lib/api';
import { SwipeCard } from './SwipeCard';

interface SwipeQuizProps {
  onComplete: () => void;
  onSelectTopic?: (question: string) => void;
}

interface QuestionsResponse {
  questions: TasteQuestion[];
}

export function SwipeQuiz({ onComplete, onSelectTopic }: SwipeQuizProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<TasteAnswer[]>([]);
  const [savedToast, setSavedToast] = useState(false);
  const savedToastTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastScale = useSharedValue(0);

  useEffect(() => {
    return () => {
      if (savedToastTimeout.current) {
        clearTimeout(savedToastTimeout.current);
      }
    };
  }, []);

  const { data, isLoading, isError, refetch } = useQuery<QuestionsResponse>({
    queryKey: ['taste-quiz'],
    queryFn: async () => {
      const res = await api.get<QuestionsResponse>('/taste-quiz?count=10');
      return res.data;
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (finalAnswers: TasteAnswer[]) => {
      await api.post('/taste-quiz', { answers: finalAnswers });
    },
  });

  const saveIdeaMutation = useMutation({
    mutationFn: async (question: TasteQuestion) => {
      await api.post('/ideas', {
        questionId: question.id,
        question: question.text,
        tagSlugs: question.tagSlugs,
        category: question.category,
      });
    },
  });

  const questions = data?.questions ?? [];
  const totalQuestions = questions.length;
  const isComplete = currentIndex >= totalQuestions && totalQuestions > 0;

  const recordAnswer = useCallback(
    (response: 'yes' | 'no') => {
      const question = questions[currentIndex];
      if (!question) return;

      const answer: TasteAnswer = {
        questionId: question.id,
        question: question.text,
        tagSlugs: question.tagSlugs,
        response,
      };

      const newAnswers = [...answers, answer];
      setAnswers(newAnswers);

      if (currentIndex + 1 >= totalQuestions) {
        submitMutation.mutate(newAnswers);
      }

      setCurrentIndex((prev) => prev + 1);
    },
    [questions, currentIndex, totalQuestions, answers, submitMutation],
  );

  const handleSwipeRight = useCallback(() => {
    const question = questions[currentIndex];
    if (question && onSelectTopic) {
      onSelectTopic(question.text);
      return;
    }
    recordAnswer('yes');
  }, [questions, currentIndex, onSelectTopic, recordAnswer]);

  const handleSwipeLeft = useCallback(() => {
    recordAnswer('no');
  }, [recordAnswer]);

  const handleLongPress = useCallback(() => {
    const question = questions[currentIndex];
    if (!question) return;

    saveIdeaMutation.mutate(question);

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
  }, [questions, currentIndex, saveIdeaMutation, toastScale]);

  const handleButtonNo = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    recordAnswer('no');
  }, [recordAnswer]);

  const handleButtonYes = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const question = questions[currentIndex];
    if (question && onSelectTopic) {
      onSelectTopic(question.text);
      return;
    }
    recordAnswer('yes');
  }, [recordAnswer, questions, currentIndex, onSelectTopic]);

  const handleButtonSave = useCallback(() => {
    handleLongPress();
  }, [handleLongPress]);

  const handleMoreQuestions = useCallback(() => {
    setCurrentIndex(0);
    setAnswers([]);
    refetch();
  }, [refetch]);

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

  if (isError || totalQuestions === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Could not load questions</Text>
        <Pressable style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  if (isComplete) {
    return (
      <Animated.View
        entering={FadeIn.duration(300)}
        style={styles.completionContainer}
      >
        <Text style={styles.completionEmoji}>{'\u2728'}</Text>
        <Text style={styles.completionTitle}>Nice taste!</Text>
        <Text style={styles.completionSubtitle}>
          We have learned your interests and will personalize your experience.
        </Text>
        <View style={styles.completionButtons}>
          <Pressable
            style={({ pressed }) => [
              styles.completionButton,
              styles.completionButtonPrimary,
              pressed && styles.completionButtonPrimaryPressed,
            ]}
            onPress={onComplete}
          >
            <Text style={styles.completionButtonPrimaryText}>Done</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.completionButton,
              styles.completionButtonSecondary,
              pressed && styles.completionButtonSecondaryPressed,
            ]}
            onPress={handleMoreQuestions}
          >
            <Text style={styles.completionButtonSecondaryText}>
              More questions
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.progressContainer}>
        <Text style={styles.progressText}>
          {currentIndex + 1} of {totalQuestions}
        </Text>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${((currentIndex + 1) / totalQuestions) * 100}%` },
            ]}
          />
        </View>
      </View>

      <View style={styles.deckContainer}>
        {questions
          .slice(currentIndex, currentIndex + 3)
          .reverse()
          .map((question, reversedIndex) => {
            const deckIndex = Math.min(2, questions.slice(currentIndex, currentIndex + 3).length - 1) - reversedIndex;
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
  errorTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.xl,
  },
  retryButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  progressContainer: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  progressText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
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
  completionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  completionEmoji: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  completionTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 32,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  completionSubtitle: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.xl,
  },
  completionButtons: {
    gap: spacing.sm,
    width: '100%',
    maxWidth: 280,
  },
  completionButton: {
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  completionButtonPrimary: {
    backgroundColor: colors.primary,
  },
  completionButtonPrimaryPressed: {
    backgroundColor: colors.primaryHover,
  },
  completionButtonPrimaryText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  completionButtonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  completionButtonSecondaryPressed: {
    backgroundColor: colors.surfaceHover,
  },
  completionButtonSecondaryText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
