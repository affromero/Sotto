import { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../lib/api';

interface QuizQuestion {
  id: string;
  order: number;
  question: string;
  options: string[];
}

interface SubmitResult {
  score: number;
  total: number;
  percentage: number;
  results: Array<{
    id: string;
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
    selectedIndex: number | null;
    isCorrect: boolean;
  }>;
}

interface PostListenQuizProps {
  podcastId: string;
  onDismiss: () => void;
}

type Phase = 'prompt' | 'quiz' | 'results';

export function PostListenQuiz({ podcastId, onDismiss }: PostListenQuizProps) {
  const [phase, setPhase] = useState<Phase>('prompt');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Map<string, number>>(new Map());
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [loading, setLoading] = useState(false);

  const loadQuiz = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/podcasts/${podcastId}/quiz`);
      if (res.data.hasSubmitted) {
        onDismiss();
        return;
      }
      setQuestions(res.data.questions);
      setPhase('quiz');
    } catch {
      onDismiss();
    } finally {
      setLoading(false);
    }
  }, [podcastId, onDismiss]);

  const submitQuiz = useCallback(async (finalAnswers: Map<string, number>) => {
    setLoading(true);
    try {
      const res = await api.post(`/podcasts/${podcastId}/quiz/submit`, {
        answers: Array.from(finalAnswers.entries()).map(([questionId, si]) => ({
          questionId,
          selectedIndex: si,
        })),
      });
      setResult(res.data);
      setPhase('results');
    } catch {
      // Quiz is non-critical — silent fail
    } finally {
      setLoading(false);
    }
  }, [podcastId]);

  function handleOptionSelect(index: number) {
    setSelectedIndex(index);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleConfirm() {
    if (selectedIndex === null || !questions[currentIndex]) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newAnswers = new Map(answers);
    newAnswers.set(questions[currentIndex].id, selectedIndex);
    setAnswers(newAnswers);

    setTimeout(() => {
      if (currentIndex < questions.length - 1) {
        setCurrentIndex(currentIndex + 1);
        setSelectedIndex(null);
      } else {
        submitQuiz(newAnswers);
      }
    }, 300);
  }

  // Prompt phase
  if (phase === 'prompt') {
    return (
      <View style={styles.root}>
        <Ionicons name="school-outline" size={32} color={colors.primary} />
        <Text style={styles.title}>Test your understanding</Text>
        <Text style={styles.subtitle}>A quick quiz on what you just listened to.</Text>
        <Pressable
          style={styles.primaryButton}
          onPress={loadQuiz}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Take Quiz"
        >
          {loading ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.primaryButtonText}>Take Quiz</Text>
          )}
        </Pressable>
        <Pressable style={styles.skipButton} onPress={onDismiss} accessibilityRole="button">
          <Text style={styles.skipButtonText}>Skip</Text>
        </Pressable>
      </View>
    );
  }

  // Results phase
  if (phase === 'results' && result) {
    return (
      <ScrollView contentContainerStyle={styles.root}>
        <View style={styles.scoreCard}>
          <Text style={styles.scoreValue}>
            {result.score}/{result.total}
          </Text>
          <Text style={styles.scoreLabel}>{result.percentage}% correct</Text>
        </View>
        {result.results.map((r, i) => (
          <View key={r.id} style={styles.reviewItem}>
            <View style={styles.reviewHeader}>
              <Ionicons
                name={r.isCorrect ? 'checkmark-circle' : 'close-circle'}
                size={20}
                color={r.isCorrect ? colors.success : (colors.error ?? '#DC2626')}
              />
              <Text style={styles.reviewQuestion} numberOfLines={3}>
                {i + 1}. {r.question}
              </Text>
            </View>
            {!r.isCorrect && r.selectedIndex !== null && (
              <Text style={styles.reviewWrong}>
                Your answer: {r.options[r.selectedIndex]}
              </Text>
            )}
            {!r.isCorrect && (
              <Text style={styles.reviewCorrectAnswer}>
                Correct: {r.options[r.correctIndex]}
              </Text>
            )}
            {r.explanation ? (
              <Text style={styles.reviewExplanation}>{r.explanation}</Text>
            ) : null}
          </View>
        ))}
        <Pressable style={styles.primaryButton} onPress={onDismiss} accessibilityRole="button">
          <Text style={styles.primaryButtonText}>Done</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // Quiz phase
  const currentQuestion = questions[currentIndex];
  if (!currentQuestion) return null;

  return (
    <View style={styles.root}>
      {/* Progress */}
      <View style={styles.progressRow}>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${((currentIndex + 1) / questions.length) * 100}%` },
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          {currentIndex + 1}/{questions.length}
        </Text>
      </View>

      <Text style={styles.questionText}>{currentQuestion.question}</Text>

      {currentQuestion.options.map((option, i) => {
        const isSelected = selectedIndex === i;
        return (
          <Pressable
            key={i}
            style={[styles.optionButton, isSelected && styles.optionButtonSelected]}
            onPress={() => handleOptionSelect(i)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
          >
            <View style={[styles.optionLetter, isSelected && styles.optionLetterSelected]}>
              <Text style={[styles.optionLetterText, isSelected && styles.optionLetterTextSelected]}>
                {String.fromCharCode(65 + i)}
              </Text>
            </View>
            <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
              {option}
            </Text>
          </Pressable>
        );
      })}

      <Pressable
        style={[styles.primaryButton, selectedIndex === null && styles.primaryButtonDisabled]}
        onPress={handleConfirm}
        disabled={selectedIndex === null || loading}
        accessibilityRole="button"
      >
        {loading ? (
          <ActivityIndicator color={colors.textInverse} />
        ) : (
          <Text style={styles.primaryButtonText}>
            {currentIndex < questions.length - 1 ? 'Next' : 'Submit'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  title: {
    fontFamily: typography.fontHeading,
    fontSize: 20,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  subtitle: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 48,
    width: '100%',
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  skipButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
  },
  skipButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    width: '100%',
    marginBottom: spacing.lg,
  },
  progressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  progressText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  questionText: {
    fontFamily: typography.fontBody,
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 24,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    width: '100%',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
    minHeight: 52,
  },
  optionButtonSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLighter,
  },
  optionLetter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionLetterSelected: {
    backgroundColor: colors.primary,
  },
  optionLetterText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  optionLetterTextSelected: {
    color: colors.textInverse,
  },
  optionText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    flex: 1,
  },
  optionTextSelected: {
    fontWeight: '600',
  },
  scoreCard: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  scoreValue: {
    fontFamily: typography.fontHeading,
    fontSize: 48,
    color: colors.primary,
  },
  scoreLabel: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  reviewItem: {
    width: '100%',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  reviewQuestion: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  reviewWrong: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.error ?? '#DC2626',
    marginTop: spacing.xs,
    marginLeft: 28,
  },
  reviewCorrectAnswer: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.success,
    fontWeight: '600',
    marginTop: spacing.xs,
    marginLeft: 28,
  },
  reviewExplanation: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginLeft: 28,
    fontStyle: 'italic',
  },
});
