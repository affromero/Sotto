import { useState, useCallback } from 'react';
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
import { UserRow } from '../../components/UserRow';
import { EmptyState } from '../../components/EmptyState';
import { BottomSheet } from '../../components/BottomSheet';

type SearchMode = 'podcasts' | 'people';

interface UserResult {
  id: string;
  name: string | null;
  handle: string | null;
  image: string | null;
}

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('podcasts');
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const debouncedQuery = query.trim();

  const { data: podcastResults, isLoading: isPodcastsLoading } = useQuery<{
    podcasts: PodcastSummary[];
  }>({
    queryKey: ['search', 'podcasts', debouncedQuery, selectedTags],
    queryFn: async () => {
      const params: Record<string, string> = {
        search: debouncedQuery,
        limit: '30',
      };
      if (selectedTags.length > 0) params.tags = selectedTags.join(',');
      const res = await api.get('/feed', { params });
      return res.data;
    },
    enabled: mode === 'podcasts' && debouncedQuery.length >= 2,
  });

  const { data: peopleResults, isLoading: isPeopleLoading } = useQuery<{
    users: UserResult[];
  }>({
    queryKey: ['search', 'people', debouncedQuery],
    queryFn: async () => {
      const res = await api.get('/users/discover', {
        params: { query: debouncedQuery },
      });
      return res.data;
    },
    enabled: mode === 'people' && debouncedQuery.length >= 2,
  });

  const { data: tagsData } = useQuery<{
    tags: Array<{ id: string; name: string; slug: string }>;
  }>({
    queryKey: ['tags'],
    queryFn: async () => {
      const res = await api.get('/tags');
      return res.data;
    },
  });

  const toggleTag = useCallback((slug: string) => {
    setSelectedTags((prev) =>
      prev.includes(slug)
        ? prev.filter((t) => t !== slug)
        : [...prev, slug],
    );
  }, []);

  const isLoading =
    mode === 'podcasts' ? isPodcastsLoading : isPeopleLoading;
  const podcasts = podcastResults?.podcasts ?? [];
  const people = peopleResults?.users ?? [];

  return (
    <View style={globalStyles.screenContainer}>
      {/* Search Input */}
      <View style={styles.searchRow}>
        <View style={styles.searchInputContainer}>
          <Ionicons
            name="search"
            size={18}
            color={colors.textTertiary}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={
              mode === 'podcasts'
                ? 'Search podcasts...'
                : 'Search people...'
            }
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            testID="search-input"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.textTertiary}
              />
            </Pressable>
          )}
        </View>
        {mode === 'podcasts' && (
          <Pressable
            style={[
              styles.filterButton,
              selectedTags.length > 0 && styles.filterButtonActive,
            ]}
            onPress={() => setFiltersVisible(true)}
            accessibilityLabel="Filter results"
            accessibilityRole="button"
          >
            <Ionicons
              name="options-outline"
              size={20}
              color={
                selectedTags.length > 0
                  ? colors.textInverse
                  : colors.textSecondary
              }
            />
          </Pressable>
        )}
      </View>

      {/* Segment Control */}
      <View style={styles.segmentRow}>
        <Pressable
          style={[styles.segment, mode === 'podcasts' && styles.segmentActive]}
          onPress={() => setMode('podcasts')}
          testID="search-mode-podcasts"
        >
          <Text
            style={[
              styles.segmentText,
              mode === 'podcasts' && styles.segmentTextActive,
            ]}
          >
            Podcasts
          </Text>
        </Pressable>
        <Pressable
          style={[styles.segment, mode === 'people' && styles.segmentActive]}
          onPress={() => setMode('people')}
          testID="search-mode-people"
        >
          <Text
            style={[
              styles.segmentText,
              mode === 'people' && styles.segmentTextActive,
            ]}
          >
            People
          </Text>
        </Pressable>
      </View>

      {/* Results */}
      {debouncedQuery.length < 2 ? (
        <EmptyState
          title="Search Sotto"
          subtitle="Find podcasts, topics, and people"
        />
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : mode === 'podcasts' ? (
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
          contentContainerStyle={
            podcasts.length === 0
              ? styles.emptyContainer
              : styles.listContent
          }
          ListEmptyComponent={
            <EmptyState
              title="No results"
              subtitle={`No podcasts found for "${debouncedQuery}"`}
            />
          }
        />
      ) : (
        <FlatList
          testID="search-results-list"
          data={people}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <UserRow
              user={item}
              onPress={() => router.push(`/user/${item.id}`)}
            />
          )}
          contentContainerStyle={
            people.length === 0
              ? styles.emptyContainer
              : styles.listContent
          }
          ListEmptyComponent={
            <EmptyState
              title="No results"
              subtitle={`No people found for "${debouncedQuery}"`}
            />
          }
        />
      )}

      {/* Filter Bottom Sheet */}
      <BottomSheet
        visible={filtersVisible}
        onClose={() => setFiltersVisible(false)}
        title="Filter by Tags"
      >
        <View style={styles.tagGrid}>
          {(tagsData?.tags ?? []).map((tag) => (
            <Pressable
              key={tag.id}
              style={[
                styles.tagChip,
                selectedTags.includes(tag.slug) && styles.tagChipActive,
              ]}
              onPress={() => toggleTag(tag.slug)}
            >
              <Text
                style={[
                  styles.tagChipText,
                  selectedTags.includes(tag.slug) &&
                    styles.tagChipTextActive,
                ]}
              >
                {tag.name}
              </Text>
            </Pressable>
          ))}
        </View>
        {selectedTags.length > 0 && (
          <Pressable
            style={styles.clearFilters}
            onPress={() => setSelectedTags([])}
          >
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
  segmentRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: borderRadius.md,
  },
  segmentActive: {
    backgroundColor: colors.primary,
  },
  segmentText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: colors.textInverse,
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
