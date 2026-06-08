/**
 * app/(tabs)/learn.tsx
 *
 * Learn dashboard: lists the user's courses.
 * - No courses -> "Take placement test" CTA -> /learn/placement
 * - Per-course card with Start/Continue -> startNextClass -> /learn/class/[id]
 * - Memory graph link per course -> /learn/memory?courseId=
 */

import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import {
  listCourses,
  startNextClass,
  type CourseSummary,
} from '../../lib/learn-api';
import { EmptyState } from '../../components/EmptyState';

// ---------------------------------------------------------------------------
// Language display helpers
// ---------------------------------------------------------------------------

const LANG_LABELS: Record<string, string> = {
  DE: 'German',
  EN: 'English',
  ES: 'Spanish',
  FR: 'French',
  IT: 'Italian',
  PT: 'Portuguese',
  JA: 'Japanese',
  ZH: 'Chinese',
};

function langLabel(code: string): string {
  return LANG_LABELS[code] ?? code;
}

// ---------------------------------------------------------------------------
// Course card
// ---------------------------------------------------------------------------

function CourseCard({ course }: { course: CourseSummary }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  const handleStart = useCallback(async () => {
    setStarting(true);
    try {
      const result = await startNextClass(course.id);
      if (result.kind === 'created') {
        router.push(`/learn/class/${result.classId}`);
      } else if (result.kind === 'gated') {
        router.push(`/learn/class/${result.activeClassId}`);
      }
      // kind === 'done' — course complete, nothing to navigate to
    } finally {
      setStarting(false);
    }
  }, [course.id, router]);

  const handleMemoryGraph = useCallback(() => {
    router.push(`/learn/memory?courseId=${course.id}`);
  }, [course.id, router]);

  const hasActiveClass = course.activeClassId != null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.langInfo}>
          <Text style={styles.targetLang}>{langLabel(course.targetLang)}</Text>
          <Text style={styles.nativeLang}>from {langLabel(course.nativeLang)}</Text>
        </View>
        <View style={styles.levelBadge}>
          <Text style={styles.levelBadgeText}>{course.currentLevel}</Text>
        </View>
      </View>

      <View style={styles.cardActions}>
        <Pressable
          style={[styles.startBtn, starting && styles.startBtnDisabled]}
          onPress={handleStart}
          disabled={starting}
          accessibilityRole="button"
          accessibilityLabel={hasActiveClass ? 'Continue class' : 'Start next class'}
        >
          {starting ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <>
              <Ionicons
                name={hasActiveClass ? 'play' : 'arrow-forward'}
                size={16}
                color={colors.textInverse}
              />
              <Text style={styles.startBtnText}>
                {hasActiveClass ? 'Continue' : 'Start'}
              </Text>
            </>
          )}
        </Pressable>

        <Pressable
          style={styles.graphBtn}
          onPress={handleMemoryGraph}
          accessibilityRole="button"
          accessibilityLabel="View memory graph"
        >
          <Ionicons name="git-network-outline" size={16} color={colors.accent} />
          <Text style={styles.graphBtnText}>Memory graph</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function LearnScreen() {
  const router = useRouter();

  const { data: courses, isLoading, isError, refetch, isRefetching } = useQuery<CourseSummary[]>({
    queryKey: ['courses'],
    queryFn: listCourses,
  });

  const handlePlacement = useCallback(() => {
    router.push('/learn/placement');
  }, [router]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Could not load courses.</Text>
        <Pressable style={styles.retryBtn} onPress={() => refetch()} accessibilityRole="button">
          <Text style={styles.retryBtnText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={courses ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => refetch()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={
          <Text style={styles.screenTitle}>Learn</Text>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <EmptyState
              iconName="school-outline"
              title="No courses yet"
              subtitle="Take a placement test to find your starting level."
            />
            <Pressable
              style={styles.placementBtn}
              onPress={handlePlacement}
              accessibilityRole="button"
              accessibilityLabel="Take placement test"
            >
              <Text style={styles.placementBtnText}>Take placement test</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => <CourseCard course={item} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      {/* Placement CTA shown below courses when courses exist */}
      {courses && courses.length > 0 && (
        <View style={styles.footer}>
          <Pressable
            style={styles.addCourseBtn}
            onPress={handlePlacement}
            accessibilityRole="button"
            accessibilityLabel="Add a new course"
          >
            <Ionicons name="add" size={18} color={colors.primary} />
            <Text style={styles.addCourseBtnText}>Add a course</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  screenTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 30,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  langInfo: {
    gap: 2,
    flex: 1,
  },
  targetLang: {
    fontFamily: typography.fontHeading,
    fontSize: 20,
    color: colors.textPrimary,
  },
  nativeLang: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
  },
  levelBadge: {
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.sm,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    alignSelf: 'flex-start',
  },
  levelBadgeText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    flex: 1,
  },
  startBtnDisabled: {
    opacity: 0.6,
  },
  startBtnText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textInverse,
  },
  graphBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.accentLight,
    minHeight: 44,
  },
  graphBtnText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '500',
    color: colors.accent,
  },
  separator: {
    height: spacing.sm,
  },
  placementBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  placementBtnText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  footer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  addCourseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  addCourseBtnText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '500',
    color: colors.primary,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: spacing.xl,
  },
  errorText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryBtnText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
