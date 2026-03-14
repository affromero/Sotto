import { useState, useCallback } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { PodcastSummary, FeedResponse, FeedSort } from '@sotto/shared';
import { api } from '../../lib/api';
import { globalStyles } from '../../lib/theme';
import { PodcastCard } from '../../components/PodcastCard';
import { SkeletonCard } from '../../components/SkeletonCard';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { FeaturedCarousel } from '../../components/FeaturedCarousel';
import { SuggestedFollows } from '../../components/SuggestedFollows';
import { Avatar } from '../../components/Avatar';
import { timeAgo } from '../../lib/formatters';

const SORT_OPTIONS: { label: string; value: FeedSort }[] = [
  { label: 'Trending', value: 'trending' },
  { label: 'Recent', value: 'recent' },
  { label: 'Popular', value: 'popular' },
];

const PAGE_LIMIT = 20;

type FeedMode = 'foryou' | 'activity';

interface ActivityItem {
  id: string;
  type: string;
  user: { id: string; name: string | null; image: string | null };
  podcast?: { id: string; title: string };
  targetUser?: { id: string; name: string | null };
  createdAt: string;
}

const ACTIVITY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  LIKE: 'heart',
  FORK: 'git-branch-outline',
  CREATE: 'add-circle-outline',
  SAVE: 'bookmark',
  FOLLOW: 'person-add-outline',
};

function getActivityText(item: ActivityItem): string {
  const name = item.user.name ?? 'Someone';
  switch (item.type) {
    case 'LIKE':
      return `${name} liked "${item.podcast?.title ?? 'a podcast'}"`;
    case 'FORK':
      return `${name} forked "${item.podcast?.title ?? 'a podcast'}"`;
    case 'CREATE':
      return `${name} created "${item.podcast?.title ?? 'a podcast'}"`;
    case 'SAVE':
      return `${name} saved "${item.podcast?.title ?? 'a podcast'}"`;
    case 'FOLLOW':
      return `${name} followed ${item.targetUser?.name ?? 'someone'}`;
    default:
      return `${name} did something`;
  }
}

export default function FeedScreen() {
  const router = useRouter();
  const [sort, setSort] = useState<FeedSort>('trending');
  const [feedMode, setFeedMode] = useState<FeedMode>('foryou');

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

  const {
    data: activityData,
    isLoading: isActivityLoading,
    refetch: refetchActivity,
    isRefetching: isActivityRefetching,
  } = useQuery<{ items: ActivityItem[] }>({
    queryKey: ['activity'],
    queryFn: async () => {
      const res = await api.get('/activity');
      return res.data;
    },
    enabled: feedMode === 'activity',
  });

  const podcasts = data?.pages.flatMap((page) => page.podcasts ?? []).filter(Boolean) ?? [];
  const activityItems = activityData?.items ?? [];

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback(
    ({ item, index }: { item: PodcastSummary; index: number }) => (
      <Animated.View entering={FadeInDown.delay(index * 80).duration(500)}>
        <PodcastCard
          podcast={item}
          variant="feed"
          onPress={() => router.push(`/podcast/${item.id}`)}
        />
      </Animated.View>
    ),
    [router],
  );

  const keyExtractor = useCallback(
    (item: PodcastSummary) => item.id,
    [],
  );

  const renderActivityItem = useCallback(
    ({ item }: { item: ActivityItem }) => (
      <Pressable
        style={({ pressed }) => [styles.activityItem, pressed && styles.activityItemPressed]}
        onPress={() => {
          if (item.podcast) router.push(`/podcast/${item.podcast.id}`);
          else if (item.targetUser) router.push(`/user/${item.targetUser.id}`);
        }}
      >
        <Avatar uri={item.user.image} name={item.user.name} size={36} />
        <View style={styles.activityContent}>
          <Text style={styles.activityText} numberOfLines={2}>
            {getActivityText(item)}
          </Text>
          <Text style={styles.activityTime}>{timeAgo(item.createdAt)}</Text>
        </View>
        <Ionicons
          name={ACTIVITY_ICONS[item.type] ?? 'ellipse'}
          size={18}
          color={colors.textTertiary}
        />
      </Pressable>
    ),
    [router],
  );

  const listHeader = (
    <>
      {/* Feed Mode Toggle */}
      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeChip, feedMode === 'foryou' && styles.modeChipActive]}
          onPress={() => setFeedMode('foryou')}
          testID="feed-mode-foryou"
        >
          <Text style={[styles.modeChipText, feedMode === 'foryou' && styles.modeChipTextActive]}>
            For You
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeChip, feedMode === 'activity' && styles.modeChipActive]}
          onPress={() => setFeedMode('activity')}
          testID="feed-mode-activity"
        >
          <Text style={[styles.modeChipText, feedMode === 'activity' && styles.modeChipTextActive]}>
            Activity
          </Text>
        </Pressable>
      </View>

      {feedMode === 'foryou' && (
        <>
          <FeaturedCarousel />
          <SuggestedFollows />
          <View style={styles.sortRow}>
            {SORT_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                testID={`feed-sort-${option.value}`}
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
        </>
      )}
    </>
  );

  if (feedMode === 'activity') {
    return (
      <View style={globalStyles.screenContainer}>
        <FlatList
          testID="feed-activity-list"
          data={activityItems}
          keyExtractor={(item) => item.id}
          renderItem={renderActivityItem}
          ListHeaderComponent={listHeader}
          contentContainerStyle={
            activityItems.length === 0 ? styles.emptyListContainer : styles.listContent
          }
          refreshControl={
            <RefreshControl
              refreshing={isActivityRefetching}
              onRefresh={() => refetchActivity()}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            isActivityLoading ? (
              <View style={styles.skeletonContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
              <EmptyState
                title="No activity yet"
                subtitle="Follow people to see their activity here"
              />
            )
          }
        />
      </View>
    );
  }

  return (
    <View style={globalStyles.screenContainer}>
      <FlatList
        testID="feed-podcast-list"
        data={podcasts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={listHeader}
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
          isLoading ? (
            <View style={styles.skeletonContainer}>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : isError ? (
            <ErrorState
              message={
                error instanceof Error ? error.message : 'Failed to load feed'
              }
              onRetry={() => refetch()}
            />
          ) : (
            <EmptyState
              title="No podcasts yet"
              subtitle="Be the first to create one"
              testID="feed-empty-state"
            />
          )
        }
        ListFooterComponent={
          isFetchingNextPage ? (
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
  skeletonContainer: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  footerLoader: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  modeRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  modeChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  modeChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  modeChipText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modeChipTextActive: {
    color: colors.textInverse,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.lg,
    gap: spacing.md,
  },
  activityItemPressed: {
    backgroundColor: colors.surfaceHover,
  },
  activityContent: {
    flex: 1,
  },
  activityText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 21,
  },
  activityTime: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
});
