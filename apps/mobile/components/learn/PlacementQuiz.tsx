/**
 * components/learn/PlacementQuiz.tsx
 *
 * Adaptive placement quiz. Fetches questions for `pair`, lets the learner
 * pick one option per question (audio playback when audioUrl is present),
 * then submits and calls onComplete with the resulting courseId + level.
 */

import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import {
  fetchPlacement,
  submitPlacement,
  PlacementQuestion,
} from '../../lib/learn-api';

// ---------------------------------------------------------------------------
// Sub-component: audio play button for a single question
// ---------------------------------------------------------------------------

function AudioPlayButton({ url }: { url: string }) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);

  const toggle = useCallback(() => {
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  }, [player, status.playing]);

  return (
    <Pressable
      onPress={toggle}
      style={({ pressed }) => [
        styles.audioBtn,
        pressed && styles.audioBtnPressed,
      ]}
      accessibilityLabel={status.playing ? 'Pause audio' : 'Play audio'}
      accessibilityRole="button"
    >
      <Text style={styles.audioBtnText}>{status.playing ? '⏸' : '▶'}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: a single question card
// ---------------------------------------------------------------------------

function QuestionCard({
  question,
  index,
  selected,
  onSelect,
}: {
  question: PlacementQuestion;
  index: number;
  selected: number | undefined;
  onSelect: (idx: number) => void;
}) {
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  return (
    <View style={styles.questionCard}>
      <Text style={styles.questionNumber}>Question {index + 1}</Text>
      {question.audioUrl && <AudioPlayButton url={question.audioUrl} />}
      <Text style={styles.questionText}>{question.prompt}</Text>
      {question.options.map((opt, i) => {
        const isSelected = selected === i;
        return (
          <Pressable
            key={i}
            onPress={() => onSelect(i)}
            style={({ pressed }) => [
              styles.option,
              isSelected && styles.optionSelected,
              pressed && !isSelected && styles.optionPressed,
            ]}
            accessibilityLabel={`Option ${LETTERS[i]}: ${opt}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
          >
            <View
              style={[
                styles.optionLetter,
                isSelected && styles.optionLetterSelected,
              ]}
            >
              <Text
                style={[
                  styles.optionLetterText,
                  isSelected && styles.optionLetterTextSelected,
                ]}
              >
                {LETTERS[i] ?? String(i + 1)}
              </Text>
            </View>
            <Text
              style={[
                styles.optionText,
                isSelected && styles.optionTextSelected,
              ]}
            >
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PlacementQuizProps {
  pair: string;
  onComplete: (courseId: string, level: string) => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PlacementQuiz({ pair, onComplete }: PlacementQuizProps) {
  const [answers, setAnswers] = useState<Record<string, number>>({});

  const { data: questions, isLoading, isError } = useQuery<PlacementQuestion[]>({
    queryKey: ['placement', pair],
    queryFn: () => fetchPlacement(pair),
  });

  const submitMutation = useMutation({
    mutationFn: () => {
      const responses = (questions ?? []).map((q) => ({
        questionId: q.id,
        selectedIndex: answers[q.id] ?? 0,
      }));
      return submitPlacement(pair, responses);
    },
    onSuccess: ({ courseId, level }) => {
      onComplete(courseId, level);
    },
  });

  const handleSelect = useCallback((questionId: string, idx: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: idx }));
  }, []);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading placement quiz…</Text>
      </View>
    );
  }

  if (isError || !questions) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>
          Could not load placement questions. Please try again.
        </Text>
      </View>
    );
  }

  const allAnswered = questions.every((q) => answers[q.id] !== undefined);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Placement Quiz</Text>
      <Text style={styles.subtitle}>
        Answer each question to find your starting level.
      </Text>

      {questions.map((q, i) => (
        <QuestionCard
          key={q.id}
          question={q}
          index={i}
          selected={answers[q.id]}
          onSelect={(idx) => handleSelect(q.id, idx)}
        />
      ))}

      <Pressable
        onPress={() => submitMutation.mutate()}
        disabled={!allAnswered || submitMutation.isPending}
        style={({ pressed }) => [
          styles.submitBtn,
          (!allAnswered || submitMutation.isPending) && styles.submitBtnDisabled,
          pressed && allAnswered && styles.submitBtnPressed,
        ]}
        accessibilityLabel="Submit placement quiz"
        accessibilityRole="button"
        accessibilityState={{ disabled: !allAnswered || submitMutation.isPending }}
      >
        {submitMutation.isPending ? (
          <ActivityIndicator color={colors.textInverse} />
        ) : (
          <Text style={styles.submitBtnText}>
            {allAnswered ? 'Submit Quiz' : `${Object.keys(answers).length} / ${questions.length} answered`}
          </Text>
        )}
      </Pressable>

      {submitMutation.isError && (
        <Text style={styles.errorText}>
          Submission failed. Please check your connection and try again.
        </Text>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  loadingText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  errorText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.error,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  title: {
    fontFamily: typography.fontHeading,
    fontSize: 26,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    lineHeight: 22,
  },
  questionCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  questionNumber: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  questionText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 24,
    marginBottom: spacing.sm,
  },
  audioBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accentLighter,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  audioBtnPressed: {
    opacity: 0.7,
  },
  audioBtnText: {
    fontSize: 18,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    marginBottom: spacing.xs,
    minHeight: 44,
    gap: spacing.sm,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}14`,
  },
  optionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionLetter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceHover,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionLetterSelected: {
    backgroundColor: colors.primary,
  },
  optionLetterText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  optionLetterTextSelected: {
    color: colors.textInverse,
  },
  optionText: {
    flex: 1,
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  optionTextSelected: {
    color: colors.textPrimary,
    fontWeight: '500',
  },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
    marginTop: spacing.md,
    minHeight: 52,
    justifyContent: 'center',
  },
  submitBtnDisabled: {
    backgroundColor: colors.border,
  },
  submitBtnPressed: {
    opacity: 0.85,
  },
  submitBtnText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
