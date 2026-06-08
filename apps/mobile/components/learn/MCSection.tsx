/**
 * components/learn/MCSection.tsx
 *
 * Multiple-choice section renderer. Shows tappable lettered options.
 * After submission marks each option correct/wrong using correctIndex.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { ClassSectionData } from '../../lib/learn-api';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MCSectionProps {
  section: ClassSectionData;
  answers: Record<string, number>;
  onSelect: (questionId: string, index: number) => void;
  submitted: boolean;
  result: { score: number; passed: boolean } | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MCSection({
  section,
  answers,
  onSelect,
  submitted,
  result,
}: MCSectionProps) {
  return (
    <View style={styles.container}>
      {result && (
        <View
          style={[
            styles.resultBanner,
            result.passed ? styles.resultBannerPassed : styles.resultBannerFailed,
          ]}
        >
          <Text style={styles.resultBannerText}>
            {result.passed ? 'Passed' : 'Not passed'} — {Math.round(result.score)}%
          </Text>
        </View>
      )}

      {section.questions.map((q) => {
        const selected = answers[q.id];

        return (
          <View key={q.id} style={styles.questionBlock}>
            {q.passageRef && (
              <Text style={styles.passageRef}>{q.passageRef}</Text>
            )}
            <Text style={styles.questionText}>{q.question}</Text>

            {q.options.map((opt, i) => {
              const isSelected = selected === i;
              const isCorrect =
                submitted && q.correctIndex !== undefined && i === q.correctIndex;
              const isWrong =
                submitted && isSelected && q.correctIndex !== undefined && i !== q.correctIndex;

              return (
                <Pressable
                  key={i}
                  onPress={() => {
                    if (!submitted) onSelect(q.id, i);
                  }}
                  disabled={submitted}
                  style={({ pressed }) => [
                    styles.option,
                    isSelected && !submitted && styles.optionSelected,
                    isCorrect && styles.optionCorrect,
                    isWrong && styles.optionWrong,
                    isSelected && !isCorrect && !isWrong && styles.optionSelected,
                    pressed && !submitted && styles.optionPressed,
                  ]}
                  accessibilityLabel={`Option ${LETTERS[i] ?? String(i + 1)}: ${opt}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected, disabled: submitted }}
                >
                  <View
                    style={[
                      styles.letterBadge,
                      isSelected && !submitted && styles.letterBadgeSelected,
                      isCorrect && styles.letterBadgeCorrect,
                      isWrong && styles.letterBadgeWrong,
                    ]}
                  >
                    <Text
                      style={[
                        styles.letterText,
                        (isSelected || isCorrect || isWrong) && styles.letterTextInverse,
                      ]}
                    >
                      {LETTERS[i] ?? String(i + 1)}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.optionText,
                      isCorrect && styles.optionTextCorrect,
                      isWrong && styles.optionTextWrong,
                    ]}
                  >
                    {opt}
                  </Text>
                  {isCorrect && (
                    <Text style={styles.icon} accessibilityLabel="Correct">
                      {''}
                    </Text>
                  )}
                  {isWrong && (
                    <Text style={styles.icon} accessibilityLabel="Wrong">
                      {''}
                    </Text>
                  )}
                </Pressable>
              );
            })}

            {submitted && q.explanation && (
              <View style={styles.explanation}>
                <Text style={styles.explanationText}>{q.explanation}</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  resultBanner: {
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    alignItems: 'center',
  },
  resultBannerPassed: {
    backgroundColor: '#D1FAE5',
  },
  resultBannerFailed: {
    backgroundColor: '#FEE2E2',
  },
  resultBannerText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  questionBlock: {
    gap: spacing.xs,
  },
  passageRef: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontStyle: 'italic',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    lineHeight: 20,
  },
  questionText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 24,
    marginBottom: spacing.xs,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    minHeight: 44,
    gap: spacing.sm,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}14`,
  },
  optionCorrect: {
    borderColor: '#10B981',
    backgroundColor: '#D1FAE5',
  },
  optionWrong: {
    borderColor: '#EF4444',
    backgroundColor: '#FEE2E2',
  },
  optionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  letterBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceHover,
    justifyContent: 'center',
    alignItems: 'center',
  },
  letterBadgeSelected: {
    backgroundColor: colors.primary,
  },
  letterBadgeCorrect: {
    backgroundColor: '#10B981',
  },
  letterBadgeWrong: {
    backgroundColor: '#EF4444',
  },
  letterText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  letterTextInverse: {
    color: '#FFFFFF',
  },
  optionText: {
    flex: 1,
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  optionTextCorrect: {
    color: '#065F46',
    fontWeight: '500',
  },
  optionTextWrong: {
    color: '#991B1B',
    fontWeight: '500',
  },
  icon: {
    fontSize: 16,
  },
  explanation: {
    backgroundColor: colors.surfaceHover,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  explanationText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
});
