import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Image,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { PodcastSummary, FeedResponse, FeedSort } from '@sotto/shared';
import { api } from '../../lib/api';

const SORT_OPTIONS: { label: string; value: FeedSort }[] = [
  { label: 'Trending', value: 'trending' },
  { label: 'Recent', value: 'recent' },
  { label: 'Popular', value: 'popular' },
];

const PAGE_LIMIT = 20;

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === 0) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 4) return `${diffWeeks}w ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

function PodcastCard({
  podcast,
  onPress,
}: {
  podcast: PodcastSummary;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View style={styles.cardHeader}>
        {podcast.user.image ? (
          <Image source={{ uri: podcast.user.image }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarFallbackText}>
              {(podcast.user.name ?? '?')[0].toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.cardHeaderText}>
          <Text style={styles.creatorName} numberOfLines={1}>
            {podcast.user.name ?? 'Unknown'}
          </Text>
          {podcast.user.handle ? (
            <Text style={styles.creatorHandle} numberOfLines={1}>
              @{podcast.user.handle}
            </Text>
          ) : null}
        </View>
        <Text style={styles.timeAgo}>{timeAgo(podcast.createdAt)}</Text>
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {podcast.title}
      </Text>
      <Text style={styles.cardTopic} numberOfLines={1}>
        {podcast.topic}
      </Text>

      {podcast.tags.length > 0 ? (
        <View style={styles.tagRow}>
          {podcast.tags.slice(0, 3).map((tag) => (
            <View key={tag.id} style={styles.tag}>
              <Text style={styles.tagText}>{tag.name}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.cardFooter}>
        <View style={styles.statRow}>
          <Text style={styles.statIcon}>&#9654;</Text>
          <Text style={styles.statText}>{formatCount(podcast.playCount)}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statIcon}>&#9825;</Text>
          <Text style={styles.statText}>{formatCount(podcast.likeCount)}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statIcon}>&#8631;</Text>
          <Text style={styles.statText}>{formatCount(podcast.forkCount)}</Text>
        </View>
        <View style={styles.durationBadge}>
          <Text style={styles.durationText}>
            {formatDuration(podcast.duration)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function FeedScreen() {
  const router = useRouter();
  const [sort, setSort] = useState<FeedSort>('trending');

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useInfiniteQuery<FeedResponse>({
    queryKey: ['feed', sort],
    queryFn: async ({ pageParam }) => {
      const response = await api.get<FeedResponse>('/feed', {
        params: { sort, page: pageParam, limit: PAGE_LIMIT },
      });
      return response.data;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
  });

  const podcasts = data?.pages.flatMap((page) => page.podcasts) ?? [];

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback(
    ({ item }: { item: PodcastSummary }) => (
      <PodcastCard
        podcast={item}
        onPress={() => router.push(`/podcast/${item.id}`)}
      />
    ),
    [router],
  );

  const keyExtractor = useCallback(
    (item: PodcastSummary) => item.id,
    [],
  );

  return (
    <View style={styles.container}>
      <View style={styles.sortRow}>
        {SORT_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            style={[
              styles.sortChip,
              sort === option.value && styles.sortChipActive,
            ]}
            onPress={() => setSort(option.value)}
          >
            <Text
              style={[
                styles.sortChipText,
                sort === option.value && styles.sortChipTextActive,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>
            {error instanceof Error
              ? error.message
              : 'Failed to load feed'}
          </Text>
          <Pressable style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={podcasts}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={
            podcasts.length === 0
              ? styles.emptyListContainer
              : styles.listContent
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && !isFetchingNextPage}
              onRefresh={() => refetch()}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No podcasts yet</Text>
              <Text style={styles.emptySubtitle}>
                Be the first to create one
              </Text>
            </View>
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  sortRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  sortChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sortChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  sortChipText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  sortChipTextActive: {
    color: colors.textInverse,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  emptyListContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardPressed: {
    backgroundColor: colors.surfaceHover,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm + 4,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarFallback: {
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarFallbackText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  cardHeaderText: {
    flex: 1,
    marginLeft: spacing.sm + 2,
  },
  creatorName: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  creatorHandle: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  timeAgo: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
  },
  cardTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: 4,
    lineHeight: 26,
  },
  cardTopic: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
    marginBottom: spacing.sm + 4,
  },
  tag: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primaryLighter,
  },
  tagText: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    fontWeight: '500',
    color: colors.primaryHover,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statIcon: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  statText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
  },
  durationBadge: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.accentSubtle,
  },
  durationText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '500',
    color: colors.accent,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  errorText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
  },
  retryButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 22,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  footerLoader: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
});
