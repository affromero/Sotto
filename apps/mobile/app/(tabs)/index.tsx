import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { PodcastSummary } from '@sotto/shared';
import { api } from '../../lib/api';
import { globalStyles } from '../../lib/theme';
import { PodcastCard } from '../../components/PodcastCard';
import { SkeletonCard } from '../../components/SkeletonCard';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';

type LibraryFilter = 'all' | 'ready' | 'private';

interface UserPodcastsResponse {
  podcasts: PodcastSummary[];
}

const FILTER_OPTIONS: Array<{
  label: string;
  value: LibraryFilter;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { label: 'All', value: 'all', icon: 'library-outline' },
  { label: 'Ready', value: 'ready', icon: 'play-circle-outline' },
  { label: 'Private', value: 'private', icon: 'lock-closed-outline' },
];

export default function LibraryScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<LibraryFilter>('all');

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery<UserPodcastsResponse>(
    {
      queryKey: ['user', 'me', 'podcasts'],
      queryFn: async () => {
        const response = await api.get<UserPodcastsResponse>('/users/me/podcasts');
        return response.data;
      },
    }
  );

  const podcasts = useMemo(() => {
    const items = [...(data?.podcasts ?? [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    switch (filter) {
      case 'ready':
        return items.filter((podcast) => podcast.status === 'READY');
      case 'private':
        return items.filter((podcast) => podcast.visibility === 'PRIVATE');
      default:
        return items;
    }
  }, [data?.podcasts, filter]);

  const stats = useMemo(() => {
    const items = data?.podcasts ?? [];
    return {
      total: items.length,
      ready: items.filter((podcast) => podcast.status === 'READY').length,
      private: items.filter((podcast) => podcast.visibility === 'PRIVATE').length,
    };
  }, [data?.podcasts]);

  const renderItem = useCallback(
    ({ item, index }: { item: PodcastSummary; index: number }) => (
      <Animated.View entering={FadeInDown.delay(index * 50).duration(350)}>
        <PodcastCard
          podcast={item}
          variant="feed"
          onPress={() => router.push(`/podcast/${item.id}`)}
        />
      </Animated.View>
    ),
    [router]
  );

  const keyExtractor = useCallback((item: PodcastSummary) => item.id, []);

  const listHeader = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <View>
          <Text style={styles.kicker}>Private library</Text>
          <Text style={styles.title}>Your lessons</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{stats.total}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{stats.ready}</Text>
          <Text style={styles.statLabel}>Ready</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{stats.private}</Text>
          <Text style={styles.statLabel}>Private</Text>
        </View>
      </View>

      <View style={styles.filterRow}>
        {FILTER_OPTIONS.map((option) => {
          const isActive = filter === option.value;
          return (
            <Pressable
              key={option.value}
              testID={`library-filter-${option.value}`}
              style={[styles.filterChip, isActive && styles.filterChipActive]}
              onPress={() => setFilter(option.value)}
            >
              <Ionicons
                name={option.icon}
                size={16}
                color={isActive ? colors.textInverse : colors.textSecondary}
              />
              <Text style={[styles.filterText, isActive && styles.filterTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={globalStyles.screenContainer}>
      <FlatList
        testID="library-podcast-list"
        data={podcasts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={listHeader}
        contentContainerStyle={
          podcasts.length === 0 ? styles.emptyListContainer : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => refetch()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.skeletonContainer}>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : isError ? (
            <ErrorState
              message={error instanceof Error ? error.message : 'Failed to load library'}
              onRetry={() => refetch()}
            />
          ) : (
            <EmptyState
              title="No podcasts yet"
              subtitle="Create your first private podcast"
              testID="library-empty-state"
            />
          )
        }
        ListFooterComponent={
          isRefetching && !isLoading ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.background,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  kicker: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 2,
  },
  title: {
    fontFamily: typography.fontHeading,
    fontSize: 28,
    color: colors.textPrimary,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: typography.fontHeading,
    fontSize: 24,
    color: colors.textPrimary,
  },
  statLabel: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterTextActive: {
    color: colors.textInverse,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  emptyListContainer: {
    flexGrow: 1,
  },
  skeletonContainer: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  footerLoader: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
});
