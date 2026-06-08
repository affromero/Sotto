/**
 * app/learn/class/[classId].tsx
 *
 * Full class screen: lesson header + sections by skill + submit.
 * GRAMMAR/READING -> MCSection
 * LISTENING       -> ListeningSection
 * SPEAKING        -> SpeakingExercise (graded async, not in MC submit)
 * Submit button collects MC answers, calls submitClass, shows per-section results.
 */

import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import {
  fetchClass,
  submitClass,
  type ClassData,
  type ClassSectionData,
  type SubmitResultData,
} from '../../../lib/learn-api';
import { MCSection } from '../../../components/learn/MCSection';
import { ListeningSection } from '../../../components/learn/ListeningSection';
import { SpeakingExercise } from '../../../components/learn/SpeakingExercise';

// ---------------------------------------------------------------------------
// Section wrapper with skill label
// ---------------------------------------------------------------------------

function SectionWrapper({
  section,
  children,
}: {
  section: ClassSectionData;
  children: React.ReactNode;
}) {
  const skillColor: Record<string, string> = {
    GRAMMAR: colors.primary,
    READING: colors.accent,
    LISTENING: colors.success,
    SPEAKING: '#7C3AED',
  };

  return (
    <View style={styles.sectionWrapper}>
      <View style={styles.sectionLabelRow}>
        <View
          style={[
            styles.skillDot,
            { backgroundColor: skillColor[section.skill] ?? colors.textSecondary },
          ]}
        />
        <Text style={styles.sectionSkill}>{section.skill}</Text>
      </View>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Result banner
// ---------------------------------------------------------------------------

function ResultBanner({ result }: { result: SubmitResultData }) {
  const passed = result.passed;
  return (
    <View style={[styles.resultBanner, passed ? styles.resultBannerPassed : styles.resultBannerFailed]}>
      <Text style={styles.resultBannerTitle}>
        {passed ? 'Passed' : 'Not passed'} — {Math.round(result.overallScore)}%
      </Text>
      <Text style={styles.resultBannerSub}>
        {result.passedSections} of {result.totalSections} sections passed
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function ClassScreen() {
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitResult, setSubmitResult] = useState<SubmitResultData | null>(null);

  const { data: classData, isLoading, isError } = useQuery<ClassData>({
    queryKey: ['class', classId],
    queryFn: () => {
      if (!classId) throw new Error('Missing classId');
      return fetchClass(classId);
    },
    enabled: !!classId,
  });

  const submitMutation = useMutation({
    mutationFn: () => {
      if (!classId) throw new Error('Missing classId');
      const mcAnswers = Object.entries(answers).map(([questionId, selectedIndex]) => ({
        questionId,
        selectedIndex,
      }));
      return submitClass(classId, mcAnswers);
    },
    onSuccess: (data) => {
      setSubmitResult(data);
    },
  });

  const handleSelect = useCallback((questionId: string, index: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: index }));
  }, []);

  const getSectionResult = useCallback(
    (sectionId: string): { score: number; passed: boolean } | null => {
      if (!submitResult) return null;
      const found = submitResult.sections.find((s) => s.id === sectionId);
      return found ? { score: found.score, passed: found.passed } : null;
    },
    [submitResult],
  );

  const submitted = submitResult != null || (classData?.submitted ?? false);

  // -------------------------------------------------------------------------
  // Loading / error states
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Class', headerBackTitle: 'Back' }} />
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading class...</Text>
      </View>
    );
  }

  if (isError || !classData) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Class', headerBackTitle: 'Back' }} />
        <Text style={styles.errorText}>Could not load this class.</Text>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Partition sections
  // -------------------------------------------------------------------------

  const mcSections = classData.sections.filter((s) => s.skill !== 'SPEAKING');
  const speakingSections = classData.sections.filter((s) => s.skill === 'SPEAKING');
  const totalMcQuestions = mcSections.reduce((acc, s) => acc + s.questions.length, 0);
  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount >= totalMcQuestions;

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen
        options={{ title: classData.lesson.title, headerBackTitle: 'Back' }}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Lesson header */}
        <View style={styles.lessonHeader}>
          <View style={styles.levelBadge}>
            <Text style={styles.levelBadgeText}>{classData.lesson.level}</Text>
          </View>
          <Text style={styles.lessonTitle}>{classData.lesson.title}</Text>
          <Text style={styles.lessonObjective}>{classData.lesson.objective}</Text>
        </View>

        {/* Overall result banner */}
        {submitResult && <ResultBanner result={submitResult} />}

        {/* MC + Listening sections */}
        {mcSections.map((section) => (
          <SectionWrapper key={section.id} section={section}>
            {section.skill === 'LISTENING' ? (
              <ListeningSection
                section={section}
                answers={answers}
                onSelect={handleSelect}
                submitted={submitted}
                result={getSectionResult(section.id)}
              />
            ) : (
              <MCSection
                section={section}
                answers={answers}
                onSelect={handleSelect}
                submitted={submitted}
                result={getSectionResult(section.id)}
              />
            )}
          </SectionWrapper>
        ))}

        {/* Submit button */}
        {!submitted && totalMcQuestions > 0 && (
          <Pressable
            style={[
              styles.submitBtn,
              (!allAnswered || submitMutation.isPending) && styles.submitBtnDisabled,
            ]}
            onPress={() => submitMutation.mutate()}
            disabled={!allAnswered || submitMutation.isPending}
            accessibilityRole="button"
            accessibilityLabel="Submit class"
            accessibilityState={{ disabled: !allAnswered || submitMutation.isPending }}
          >
            {submitMutation.isPending ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.submitBtnText}>
                {allAnswered
                  ? 'Submit'
                  : `${answeredCount} / ${totalMcQuestions} answered`}
              </Text>
            )}
          </Pressable>
        )}

        {submitMutation.isError && (
          <Text style={styles.errorText}>Submission failed. Please try again.</Text>
        )}

        {/* Speaking sections — always shown, graded async */}
        {speakingSections.map((section) => (
          <SectionWrapper key={section.id} section={section}>
            <SpeakingExercise classId={classData.id} prompts={section.prompts} />
          </SectionWrapper>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 3,
    gap: spacing.lg,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  loadingText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
  },
  errorText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.error,
    textAlign: 'center',
  },
  lessonHeader: {
    gap: spacing.sm,
  },
  levelBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.sm,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  levelBadgeText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lessonTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 24,
    color: colors.textPrimary,
    lineHeight: 32,
  },
  lessonObjective: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  resultBanner: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.xs,
    alignItems: 'center',
  },
  resultBannerPassed: {
    backgroundColor: colors.successLighter,
    borderWidth: 1,
    borderColor: colors.successLight,
  },
  resultBannerFailed: {
    backgroundColor: colors.errorLighter,
    borderWidth: 1,
    borderColor: colors.errorLight,
  },
  resultBannerTitle: {
    fontFamily: typography.fontBody,
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  resultBannerSub: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
  },
  sectionWrapper: {
    gap: spacing.sm,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  skillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sectionSkill: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
