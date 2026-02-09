'use client';

import { useCallback, useState } from 'react';
import { SearchBar } from '@/components/feed/SearchBar';
import { TagFilter } from '@/components/feed/TagFilter';
import { FilterPanel, type AdvancedFilters } from '@/components/feed/FilterPanel';
import { TrendingSection } from '@/components/feed/TrendingSection';
import { FeedGrid } from '@/components/feed/FeedGrid';
import { PodcastCard } from '@/components/feed/PodcastCard';
import type { PodcastSummary } from '@/types/podcast';
import styles from './page.module.css';

interface Tag {
  id: string;
  name: string;
  slug: string;
}

interface FeedClientProps {
  initialPodcasts: PodcastSummary[];
  trendingPodcasts: PodcastSummary[];
  tags: Tag[];
}

export function FeedClient({
  initialPodcasts,
  trendingPodcasts,
  tags,
}: FeedClientProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | undefined>(undefined);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>({});
  const [podcasts, setPodcasts] = useState(initialPodcasts);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialPodcasts.length >= 24);

  const fetchPodcasts = useCallback(
    async (query: string, tag: string | undefined, filters: AdvancedFilters, append = false) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query) params.set('search', query);
        if (tag) params.set('tag', tag);
        if (filters.depth) params.set('depth', filters.depth);
        if (filters.audience) params.set('audience', filters.audience);
        if (filters.tone) params.set('tone', filters.tone);
        if (filters.durationMin !== undefined) params.set('durationMin', String(filters.durationMin));
        if (filters.durationMax !== undefined) params.set('durationMax', String(filters.durationMax));
        if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
        if (filters.dateTo) params.set('dateTo', filters.dateTo);
        if (append && podcasts.length > 0) {
          params.set('page', String(Math.floor(podcasts.length / 20) + 1));
        }

        const response = await fetch(`/api/feed?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          if (append) {
            setPodcasts((prev) => [...prev, ...data.podcasts]);
          } else {
            setPodcasts(data.podcasts);
          }
          setHasMore(data.hasMore ?? false);
        }
      } finally {
        setLoading(false);
      }
    },
    [podcasts]
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (value.length === 0 || value.length >= 2) {
        fetchPodcasts(value, activeTag, advancedFilters);
      }
    },
    [activeTag, advancedFilters, fetchPodcasts]
  );

  const handleTagSelect = useCallback(
    (slug: string | undefined) => {
      setActiveTag(slug);
      fetchPodcasts(searchQuery, slug, advancedFilters);
    },
    [searchQuery, advancedFilters, fetchPodcasts]
  );

  const handleFiltersChange = useCallback(
    (filters: AdvancedFilters) => {
      setAdvancedFilters(filters);
      fetchPodcasts(searchQuery, activeTag, filters);
    },
    [searchQuery, activeTag, fetchPodcasts]
  );

  const handleLoadMore = useCallback(() => {
    fetchPodcasts(searchQuery, activeTag, advancedFilters, true);
  }, [searchQuery, activeTag, advancedFilters, fetchPodcasts]);

  const hasActiveFilters = Object.values(advancedFilters).some((v) => v !== undefined);
  const showTrending = !searchQuery && !activeTag && !hasActiveFilters && trendingPodcasts.length > 0;

  return (
    <div className={styles.feedContent}>
      <div className={styles.filters}>
        <SearchBar
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Search podcasts by topic, title, or creator..."
        />
        {tags.length > 0 && (
          <TagFilter
            tags={tags}
            activeTag={activeTag}
            onTagSelect={handleTagSelect}
          />
        )}
        <FilterPanel
          filters={advancedFilters}
          onChange={handleFiltersChange}
        />
      </div>

      {showTrending && (
        <TrendingSection podcasts={trendingPodcasts} />
      )}

      <section aria-label="Podcast feed">
        <FeedGrid
          loading={loading && podcasts.length === 0}
          emptyMessage={
            searchQuery
              ? `No podcasts found for "${searchQuery}"`
              : 'No podcasts yet. Be the first to create one!'
          }
        >
          {podcasts.map((podcast) => (
            <PodcastCard key={podcast.id} podcast={podcast} />
          ))}
        </FeedGrid>
      </section>

      {hasMore && podcasts.length > 0 && (
        <div className={styles.loadMoreRow}>
          <button
            className={styles.loadMoreBtn}
            onClick={handleLoadMore}
            disabled={loading}
            type="button"
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  );
}
