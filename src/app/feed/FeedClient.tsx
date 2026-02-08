'use client';

import { useCallback, useState } from 'react';
import { SearchBar } from '@/components/feed/SearchBar';
import { TagFilter } from '@/components/feed/TagFilter';
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
  const [podcasts, setPodcasts] = useState(initialPodcasts);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialPodcasts.length >= 24);

  const fetchPodcasts = useCallback(
    async (query: string, tag: string | undefined, append = false) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        if (tag) params.set('tag', tag);
        if (append && podcasts.length > 0) {
          params.set('cursor', podcasts[podcasts.length - 1].id);
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
        fetchPodcasts(value, activeTag);
      }
    },
    [activeTag, fetchPodcasts]
  );

  const handleTagSelect = useCallback(
    (slug: string | undefined) => {
      setActiveTag(slug);
      fetchPodcasts(searchQuery, slug);
    },
    [searchQuery, fetchPodcasts]
  );

  const handleLoadMore = useCallback(() => {
    fetchPodcasts(searchQuery, activeTag, true);
  }, [searchQuery, activeTag, fetchPodcasts]);

  const showTrending = !searchQuery && !activeTag && trendingPodcasts.length > 0;

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
