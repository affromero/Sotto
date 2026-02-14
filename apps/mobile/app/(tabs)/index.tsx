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
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { PodcastSummary, FeedResponse, FeedSort } from '@sotto/shared';
import { api } from '../../lib/api';
import { globalStyles } from '../../lib/theme';
import { PodcastCard } from '../../components/PodcastCard';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';

const SORT_OPTIONS: { label: string; value: FeedSort }[] = [
  { label: 'Trending', value: 'trending' },
  { label: 'Recent', value: 'recent' },
  { label: 'Popular', value: 'popular' },
];

const PAGE_LIMIT = 20;

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
        variant="feed"
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
    <View style={globalStyles.screenContainer}>
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
        <ErrorState
          message={
            error instanceof Error ? error.message : 'Failed to load feed'
          }
          onRetry={() => refetch()}
        />
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
            <EmptyState
              title="No podcasts yet"
              subtitle="Be the first to create one"
            />
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  footerLoader: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
});
