import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Stack } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { shadowSm } from '../lib/shadows';

interface BrowseVoice {
  id: string;
  name: string;
  description: string | null;
  sourceType: string;
  priceInCents: number | null;
  owner: {
    id: string;
    name: string | null;
    handle: string | null;
    image: string | null;
  };
  isVerified: boolean;
  approvedCount: number;
  requestStatus: string | null;
  hasAccess: boolean;
}

type Sort = 'recent' | 'most_requested';

export default function VoiceMarketplaceScreen() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('most_requested');

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['voices-browse', search, sort],
    queryFn: async ({ pageParam = 1 }) => {
      const res = await api.get('/voices/browse', {
        params: {
          search: search.trim() || undefined,
          sort,
          page: pageParam,
          limit: 15,
        },
      });
      return res.data as { voices: BrowseVoice[]; hasMore: boolean; page: number };
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    initialPageParam: 1,
  });

  const voices = data?.pages.flatMap((p) => p.voices) ?? [];

  const renderItem = useCallback(
    ({ item }: { item: BrowseVoice }) => {
      const isFree = !item.priceInCents || item.priceInCents === 0;
      return (
        <View style={styles.card} testID={`voice-marketplace-card-${item.id}`}>
          <View style={styles.cardRow}>
            <Avatar uri={item.owner?.image} name={item.owner?.name} size={44} />
            <View style={styles.cardInfo}>
              <View style={styles.cardNameRow}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.isVerified && (
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                )}
              </View>
              <Text style={styles.cardOwner} numberOfLines={1}>
                by {item.owner?.name ?? item.owner?.handle ?? 'Unknown'}
              </Text>
              {item.description && (
                <Text style={styles.cardDescription} numberOfLines={2}>
                  {item.description}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.cardFooter}>
            <Text style={styles.cardPrice}>
              {isFree ? 'Free' : `$${(item.priceInCents! / 100).toFixed(2)}`}
            </Text>
            <Text style={styles.cardUsage}>
              {item.approvedCount} user{item.approvedCount !== 1 ? 's' : ''}
            </Text>
            {item.hasAccess && (
              <View style={styles.accessBadge}>
                <Ionicons name="checkmark" size={12} color={colors.success} />
                <Text style={styles.accessBadgeText}>Access</Text>
              </View>
            )}
          </View>
        </View>
      );
    },
    [],
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Voice Marketplace' }} />

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color={colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search voices..."
          placeholderTextColor={colors.textTertiary}
          testID="voice-marketplace-search-input"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} hitSlop={8} testID="voice-marketplace-search-clear">
            <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
          </Pressable>
        )}
      </View>

      <View style={styles.sortRow}>
        {(['most_requested', 'recent'] as Sort[]).map((s) => (
          <Pressable
            key={s}
            testID={`voice-marketplace-sort-${s}`}
            style={[styles.sortChip, sort === s && styles.sortChipActive]}
            onPress={() => setSort(s)}
          >
            <Text
              style={[
                styles.sortChipText,
                sort === s && styles.sortChipTextActive,
              ]}
            >
              {s === 'most_requested' ? 'Popular' : 'Recent'}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          testID="voice-marketplace-list"
          data={voices}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onEndReached={() => {
            if (hasNextPage) fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator
                size="small"
                color={colors.primary}
                style={styles.footerLoader}
              />
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="mic-off-outline" size={48} color={colors.textTertiary} />
              <Text style={styles.emptyText}>No voices found</Text>
            </View>
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: spacing.sm + 2,
  },
  sortRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
  },
  sortChip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  sortChipText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  sortChipTextActive: {
    color: colors.textInverse,
  },
  listContent: {
    padding: spacing.lg,
    paddingTop: 0,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    ...shadowSm,
  },
  cardRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  cardInfo: {
    flex: 1,
  },
  cardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  cardName: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  cardOwner: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: 2,
  },
  cardDescription: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  cardPrice: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  cardUsage: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textTertiary,
  },
  accessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
  },
  accessBadgeText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.success,
    fontWeight: '500',
  },
  emptyText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textTertiary,
  },
  footerLoader: {
    paddingVertical: spacing.lg,
  },
});
