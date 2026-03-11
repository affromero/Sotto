import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../lib/api';
import { shadowSm, shadowMd } from '../lib/shadows';

type Period = '7d' | '30d' | '90d' | 'all';

interface AnalyticsData {
  overview: {
    totalPlays: number;
    uniqueListeners: number;
    avgCompletion: number;
    totalListenHours: number;
    podcastCount: number;
  };
  topPodcasts: {
    id: string;
    title: string | null;
    plays: number;
    completionPercent: number;
    likes: number;
    forks: number;
  }[];
  engagement: {
    likes: number;
    saves: number;
    comments: number;
    forks: number;
    follows: number;
    interactions: number;
  };
  period: string;
}

const PERIODS: { value: Period; label: string }[] = [
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
  { value: 'all', label: 'All Time' },
];

function StatCard({
  icon,
  label,
  value,
  suffix,
}: {
  icon: string;
  label: string;
  value: number | string;
  suffix?: string;
}) {
  return (
    <View style={styles.statCard}>
      <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={20} color={colors.primary} />
      <Text style={styles.statValue}>
        {typeof value === 'number' ? value.toLocaleString() : value}
        {suffix ? ` ${suffix}` : ''}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function AnalyticsScreen() {
  const [period, setPeriod] = useState<Period>('30d');

  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ['creator-analytics', period],
    queryFn: async () => {
      const res = await api.get('/creator-analytics', { params: { period } });
      return res.data;
    },
  });

  const renderPeriodSelector = useCallback(
    () => (
      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <Pressable
            key={p.value}
            testID={`analytics-period-${p.value}`}
            style={[
              styles.periodChip,
              period === p.value && styles.periodChipActive,
            ]}
            onPress={() => setPeriod(p.value)}
          >
            <Text
              style={[
                styles.periodChipText,
                period === p.value && styles.periodChipTextActive,
              ]}
            >
              {p.label}
            </Text>
          </Pressable>
        ))}
      </View>
    ),
    [period],
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Analytics' }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {renderPeriodSelector()}

        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : data ? (
          <>
            {/* Overview stats */}
            <View style={styles.statsGrid} testID="analytics-stats-grid">
              <StatCard
                icon="play-circle-outline"
                label="Total Plays"
                value={data.overview.totalPlays}
              />
              <StatCard
                icon="people-outline"
                label="Listeners"
                value={data.overview.uniqueListeners}
              />
              <StatCard
                icon="time-outline"
                label="Listen Hours"
                value={Math.round(data.overview.totalListenHours * 10) / 10}
              />
              <StatCard
                icon="checkmark-circle-outline"
                label="Avg Completion"
                value={Math.round(data.overview.avgCompletion)}
                suffix="%"
              />
            </View>

            {/* Engagement */}
            <Text style={styles.sectionTitle}>Engagement</Text>
            <View style={styles.engagementCard} testID="analytics-engagement-card">
              {[
                { label: 'Likes', value: data.engagement.likes, icon: 'heart-outline' },
                { label: 'Saves', value: data.engagement.saves, icon: 'bookmark-outline' },
                { label: 'Comments', value: data.engagement.comments, icon: 'chatbubble-outline' },
                { label: 'Forks', value: data.engagement.forks, icon: 'git-branch-outline' },
                { label: 'Follows', value: data.engagement.follows, icon: 'person-add-outline' },
                { label: 'Questions', value: data.engagement.interactions, icon: 'help-circle-outline' },
              ].map((item, i, arr) => (
                <View key={item.label}>
                  <View style={styles.engagementRow}>
                    <View style={styles.engagementLeft}>
                      <Ionicons
                        name={item.icon as keyof typeof Ionicons.glyphMap}
                        size={18}
                        color={colors.textSecondary}
                      />
                      <Text style={styles.engagementLabel}>{item.label}</Text>
                    </View>
                    <Text style={styles.engagementValue}>
                      {item.value.toLocaleString()}
                    </Text>
                  </View>
                  {i < arr.length - 1 && <View style={styles.separator} />}
                </View>
              ))}
            </View>

            {/* Top Podcasts */}
            {data.topPodcasts.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Top Podcasts</Text>
                {data.topPodcasts.slice(0, 5).map((podcast, index) => (
                  <View key={podcast.id} style={styles.topPodcastCard}>
                    <Text style={styles.topPodcastRank}>#{index + 1}</Text>
                    <View style={styles.topPodcastInfo}>
                      <Text style={styles.topPodcastTitle} numberOfLines={1}>
                        {podcast.title ?? 'Untitled'}
                      </Text>
                      <Text style={styles.topPodcastMeta}>
                        {podcast.plays} plays · {podcast.likes} likes · {podcast.completionPercent}% completion
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  centered: {
    paddingVertical: spacing.xl * 2,
    alignItems: 'center',
  },
  periodRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  periodChip: {
    flex: 1,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  periodChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  periodChipText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  periodChipTextActive: {
    color: colors.textInverse,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  statCard: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
    ...shadowMd,
  },
  statValue: {
    fontFamily: typography.fontHeading,
    fontSize: 22,
    color: colors.textPrimary,
  },
  statLabel: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
  },
  sectionTitle: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  engagementCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    ...shadowSm,
  },
  engagementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  engagementLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  engagementLabel: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
  },
  engagementValue: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: spacing.md,
  },
  topPodcastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadowSm,
  },
  topPodcastRank: {
    fontFamily: typography.fontHeading,
    fontSize: 18,
    color: colors.primary,
    width: 36,
  },
  topPodcastInfo: {
    flex: 1,
  },
  topPodcastTitle: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  topPodcastMeta: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textTertiary,
  },
});
