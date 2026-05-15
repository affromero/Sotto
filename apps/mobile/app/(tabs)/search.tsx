import { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { PodcastSummary } from '@sotto/shared';
import { api } from '../../lib/api';
import { globalStyles } from '../../lib/theme';
import { PodcastCard } from '../../components/PodcastCard';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { BottomSheet } from '../../components/BottomSheet';

interface UserPodcastsResponse {
  podcasts: PodcastSummary[];
}

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const debouncedQuery = query.trim().toLowerCase();

  const { data, isLoading, isError, refetch } = useQuery<UserPodcastsResponse>({
    queryKey: ['user', 'me', 'podcasts'],
    queryFn: async () => {
      const response = await api.get<UserPodcastsResponse>('/users/me/podcasts');
      return response.data;
    },
  });

  const tags = useMemo(() => {
    const bySlug = new Map<string, { id: string; name: string; slug: string }>();
    for (const podcast of data?.podcasts ?? []) {
      for (const tag of podcast.tags ?? []) {
        bySlug.set(tag.slug, tag);
      }
    }
    return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data?.podcasts]);

  const podcasts = useMemo(() => {
    if (debouncedQuery.length < 2) return [];

    return (data?.podcasts ?? []).filter((podcast) => {
      const matchesText =
        podcast.title.toLowerCase().includes(debouncedQuery) ||
        podcast.topic.toLowerCase().includes(debouncedQuery);
      const matchesTags =
        selectedTags.length === 0 ||
        selectedTags.every((slug) => podcast.tags?.some((tag) => tag.slug === slug));
      return matchesText && matchesTags;
    });
  }, [data?.podcasts, debouncedQuery, selectedTags]);

  const toggleTag = useCallback((slug: string) => {
    setSelectedTags((prev) =>
      prev.includes(slug) ? prev.filter((tag) => tag !== slug) : [...prev, slug]
    );
  }, []);

  return (
    <View style={globalStyles.screenContainer}>
      <View style={styles.searchRow}>
        <View style={styles.searchInputContainer}>
          <Ionicons name="search" size={18} color={colors.textTertiary} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search your podcasts..."
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            testID="search-input"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </Pressable>
          )}
        </View>
        <Pressable
          style={[styles.filterButton, selectedTags.length > 0 && styles.filterButtonActive]}
          onPress={() => setFiltersVisible(true)}
          accessibilityLabel="Filter private podcast results"
          accessibilityRole="button"
        >
          <Ionicons
            name="options-outline"
            size={20}
            color={selectedTags.length > 0 ? colors.textInverse : colors.textSecondary}
          />
        </Pressable>
      </View>

      {debouncedQuery.length < 2 ? (
        <EmptyState
          title="Search your library"
          subtitle="Find private podcasts by title, topic, or tag"
        />
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError ? (
        <ErrorState message="Failed to load your podcasts" onRetry={refetch} />
      ) : (
        <FlatList
          testID="search-results-list"
          data={podcasts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PodcastCard
              podcast={item}
              variant="feed"
              onPress={() => router.push(`/podcast/${item.id}`)}
            />
          )}
          contentContainerStyle={podcasts.length === 0 ? styles.emptyContainer : styles.listContent}
          ListEmptyComponent={
            <EmptyState
              title="No results"
              subtitle={`No private podcasts found for "${query.trim()}"`}
            />
          }
        />
      )}

      <BottomSheet
        visible={filtersVisible}
        onClose={() => setFiltersVisible(false)}
        title="Filter by Tags"
      >
        <View style={styles.tagGrid}>
          {tags.map((tag) => (
            <Pressable
              key={tag.id}
              style={[styles.tagChip, selectedTags.includes(tag.slug) && styles.tagChipActive]}
              onPress={() => toggleTag(tag.slug)}
            >
              <Text
                style={[
                  styles.tagChipText,
                  selectedTags.includes(tag.slug) && styles.tagChipTextActive,
                ]}
              >
                {tag.name}
              </Text>
            </Pressable>
          ))}
        </View>
        {selectedTags.length > 0 && (
          <Pressable style={styles.clearFilters} onPress={() => setSelectedTags([])}>
            <Text style={styles.clearFiltersText}>Clear All</Text>
          </Pressable>
        )}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textPrimary,
  },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  tagChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tagChipText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  tagChipTextActive: {
    color: colors.textInverse,
  },
  clearFilters: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  clearFiltersText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.error,
  },
});
