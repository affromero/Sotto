'use client';

import { useState, useCallback } from 'react';
import { Search } from 'lucide-react';
import { PodcastCard } from './PodcastCard';
import { useImpressionTracker } from '@/lib/hooks/useImpressionTracker';
import type { PodcastSummary } from '@/types/podcast';
import styles from './ExploreGrid.module.css';

interface ExploreResult {
  podcastId: string;
  title: string;
  topic: string;
  duration: number | null;
  audioUrl: string | null;
  playCount: number;
  likeCount: number;
  forkCount: number;
  createdAt: string;
  user: { id: string; name: string | null; image: string | null; handle?: string | null };
  tags: Array<{ id: string; name: string; slug: string }>;
  ownerIsPro?: boolean;
  score: number;
  explanation: string;
}

interface ExploreGridProps {
  tags: Array<{ id: string; name: string; slug: string }>;
}

function resultToPodcastSummary(result: ExploreResult): PodcastSummary {
  return {
    id: result.podcastId,
    title: result.title,
    topic: result.topic,
    status: 'READY',
    visibility: 'PUBLIC',
    audioUrl: result.audioUrl,
    duration: result.duration,
    playCount: result.playCount,
    likeCount: result.likeCount,
    forkCount: result.forkCount,
    createdAt: result.createdAt,
    source: 'WEB',
    isHumanContent: false,
    forkedFromId: null,
    ownerIsPro: result.ownerIsPro ?? false,
    user: {
      ...result.user,
      handle: result.user.handle || null,
    },
    tags: result.tags,
  };
}

export function ExploreGrid({ tags }: ExploreGridProps) {
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [results, setResults] = useState<ExploreResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const { observe } = useImpressionTracker();

  const handleSearch = useCallback(async () => {
    if (!query.trim() && !selectedTag) return;

    setIsSearching(true);
    setHasSearched(true);

    const params = new URLSearchParams({ mode: 'explore' });
    if (query.trim()) params.set('query', query.trim());
    if (selectedTag) params.set('tag', selectedTag);

    try {
      const res = await fetch(`/api/feed?${params}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.podcasts || []);
      }
    } catch {
      // Silent failure
    } finally {
      setIsSearching(false);
    }
  }, [query, selectedTag]);

  const handleTagClick = useCallback(
    (slug: string) => {
      setSelectedTag(selectedTag === slug ? null : slug);
    },
    [selectedTag]
  );

  return (
    <section className={styles.root}>
      <h2 className={styles.title}>Explore</h2>
      <p className={styles.subtitle}>
        Find the best podcasts on any topic. Max 10 results — be specific.
      </p>

      <div className={styles.searchRow}>
        <div className={styles.searchInput}>
          <Search size={18} className={styles.searchIcon} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search by topic..."
            className={styles.input}
            aria-label="Search podcasts by topic"
          />
        </div>
        <button
          type="button"
          className={styles.searchButton}
          onClick={handleSearch}
          disabled={isSearching}
        >
          {isSearching ? 'Searching...' : 'Search'}
        </button>
      </div>

      <div className={styles.tagRow} role="group" aria-label="Filter by tag">
        {tags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className={`${styles.tagButton} ${selectedTag === tag.slug ? styles.tagActive : ''}`}
            onClick={() => handleTagClick(tag.slug)}
          >
            {tag.name}
          </button>
        ))}
      </div>

      {isSearching && <div className={styles.loading}>Searching...</div>}

      {hasSearched && !isSearching && results.length === 0 && (
        <div className={styles.empty}>
          <p>No results found. Try a different search or create your own podcast.</p>
        </div>
      )}

      {results.length > 0 && (
        <div className={styles.grid}>
          {results.map((result, idx) => (
            <PodcastCard
              key={result.podcastId}
              podcast={resultToPodcastSummary(result)}
              position={idx}
              feedSort="explore"
              searchQuery={query}
              observeRef={observe}
            />
          ))}
        </div>
      )}

      {results.length >= 10 && (
        <p className={styles.limitNote}>
          Showing top 10 results. Try a more specific search to narrow down.
        </p>
      )}
    </section>
  );
}
