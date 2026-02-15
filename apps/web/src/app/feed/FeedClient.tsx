'use client';

import { useCallback, useState } from 'react';
import { SearchBar } from '@/components/feed/SearchBar';
import { TagFilter } from '@/components/feed/TagFilter';
import { FilterPanel, type AdvancedFilters } from '@/components/feed/FilterPanel';
import { HeroSection } from '@/components/feed/HeroSection';
import { TrendingSection } from '@/components/feed/TrendingSection';
import { SuggestedFollows } from '@/components/feed/SuggestedFollows';
import { FeedGrid } from '@/components/feed/FeedGrid';
import { PodcastCard } from '@/components/feed/PodcastCard';
import { UserSearchGrid, type UserDiscoveryResult } from '@/components/feed/UserSearchGrid';
import { ActivityFeed } from '@/components/feed/ActivityFeed';
import type { PodcastSummary } from '@/types/podcast';
import styles from './page.module.css';

interface Tag {
  id: string;
  name: string;
  slug: string;
}

type FeedTab = 'discover' | 'activity';
type SearchMode = 'podcasts' | 'people';

interface FeedClientProps {
  initialPodcasts: PodcastSummary[];
  heroPodcasts: PodcastSummary[];
  trendingPodcasts: PodcastSummary[];
  tags: Tag[];
  isAuthenticated?: boolean;
  currentUserId: string | null;
}

type SortOption = 'recent' | 'popular' | 'trending' | 'most_forked';
type ModeOption = 'all' | 'remixes';

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'recent', label: 'Recent' },
  { value: 'popular', label: 'Popular' },
  { value: 'trending', label: 'Trending' },
  { value: 'most_forked', label: 'Most Forked' },
];

export function FeedClient({ initialPodcasts, heroPodcasts, trendingPodcasts, tags, isAuthenticated, currentUserId }: FeedClientProps) {
  const [activeTab, setActiveTab] = useState<FeedTab>('discover');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | undefined>(undefined);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>({});
  const [podcasts, setPodcasts] = useState(initialPodcasts);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialPodcasts.length >= 24);
  const [sort, setSort] = useState<SortOption>('recent');
  const [mode, setMode] = useState<ModeOption>('all');

  // People search state
  const [searchMode, setSearchMode] = useState<SearchMode>('podcasts');
  const [userResults, setUserResults] = useState<UserDiscoveryResult[]>([]);
  const [userLoading, setUserLoading] = useState(false);
  const [userHasMore, setUserHasMore] = useState(false);
  const [userPage, setUserPage] = useState(1);

  const fetchPodcasts = useCallback(
    async (
      query: string,
      tag: string | undefined,
      filters: AdvancedFilters,
      sortBy: SortOption,
      feedMode: ModeOption,
      append = false
    ) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query) params.set('search', query);
        if (tag) params.set('tag', tag);
        if (sortBy !== 'recent') params.set('sort', sortBy);
        if (feedMode === 'remixes') params.set('mode', 'remixes');
        if (filters.depth) params.set('depth', filters.depth);
        if (filters.audience) params.set('audience', filters.audience);
        if (filters.tone) params.set('tone', filters.tone);
        if (filters.durationMin !== undefined)
          params.set('durationMin', String(filters.durationMin));
        if (filters.durationMax !== undefined)
          params.set('durationMax', String(filters.durationMax));
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

  const fetchUsers = useCallback(
    async (query: string, append = false) => {
      if (query.length < 2) {
        if (!append) {
          setUserResults([]);
          setUserHasMore(false);
          setUserPage(1);
        }
        return;
      }

      setUserLoading(true);
      try {
        const page = append ? userPage + 1 : 1;
        const params = new URLSearchParams({
          query,
          page: String(page),
          limit: '20',
        });
        const response = await fetch(`/api/users/discover?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          if (append) {
            setUserResults((prev) => [...prev, ...data.users]);
          } else {
            setUserResults(data.users);
          }
          setUserHasMore(data.hasMore ?? false);
          setUserPage(page);
        }
      } finally {
        setUserLoading(false);
      }
    },
    [userPage]
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (value.length === 0 || value.length >= 2) {
        if (searchMode === 'people') {
          fetchUsers(value);
        } else {
          fetchPodcasts(value, activeTag, advancedFilters, sort, mode);
        }
      }
    },
    [activeTag, advancedFilters, sort, mode, fetchPodcasts, fetchUsers, searchMode]
  );

  const handleSearchModeChange = useCallback(
    (newMode: SearchMode) => {
      setSearchMode(newMode);
      if (newMode === 'people' && searchQuery.length >= 2) {
        fetchUsers(searchQuery);
      } else if (newMode === 'podcasts') {
        fetchPodcasts(searchQuery, activeTag, advancedFilters, sort, mode);
      }
    },
    [searchQuery, activeTag, advancedFilters, sort, mode, fetchPodcasts, fetchUsers]
  );

  const handleTagSelect = useCallback(
    (slug: string | undefined) => {
      setActiveTag(slug);
      fetchPodcasts(searchQuery, slug, advancedFilters, sort, mode);
    },
    [searchQuery, advancedFilters, sort, mode, fetchPodcasts]
  );

  const handleFiltersChange = useCallback(
    (filters: AdvancedFilters) => {
      setAdvancedFilters(filters);
      fetchPodcasts(searchQuery, activeTag, filters, sort, mode);
    },
    [searchQuery, activeTag, sort, mode, fetchPodcasts]
  );

  const handleSortChange = useCallback(
    (newSort: SortOption) => {
      setSort(newSort);
      fetchPodcasts(searchQuery, activeTag, advancedFilters, newSort, mode);
    },
    [searchQuery, activeTag, advancedFilters, mode, fetchPodcasts]
  );

  const handleModeChange = useCallback(
    (newMode: ModeOption) => {
      setMode(newMode);
      fetchPodcasts(searchQuery, activeTag, advancedFilters, sort, newMode);
    },
    [searchQuery, activeTag, advancedFilters, sort, fetchPodcasts]
  );

  const handleLoadMore = useCallback(() => {
    if (searchMode === 'people') {
      fetchUsers(searchQuery, true);
    } else {
      fetchPodcasts(searchQuery, activeTag, advancedFilters, sort, mode, true);
    }
  }, [searchQuery, activeTag, advancedFilters, sort, mode, fetchPodcasts, fetchUsers, searchMode]);

  const hasActiveFilters = Object.values(advancedFilters).some((v) => v !== undefined);
  const isDefaultView =
    !searchQuery &&
    !activeTag &&
    !hasActiveFilters &&
    sort === 'recent' &&
    mode === 'all';
  const showHero = isDefaultView && searchMode === 'podcasts' && heroPodcasts.length > 0;
  const showTrending = isDefaultView && searchMode === 'podcasts' && trendingPodcasts.length > 0;
  const showSuggested = isAuthenticated && currentUserId && isDefaultView && searchMode === 'podcasts';
  const isPeopleMode = searchMode === 'people';

  return (
    <div className={styles.feedContent}>
      {isAuthenticated && (
        <div className={styles.feedTabs} role="tablist" aria-label="Feed tabs">
          <button
            className={`${styles.feedTab} ${activeTab === 'discover' ? styles.feedTabActive : ''}`}
            onClick={() => setActiveTab('discover')}
            role="tab"
            aria-selected={activeTab === 'discover'}
            aria-controls="feed-discover-panel"
            id="feed-discover-tab"
            type="button"
          >
            Discover
          </button>
          <button
            className={`${styles.feedTab} ${activeTab === 'activity' ? styles.feedTabActive : ''}`}
            onClick={() => setActiveTab('activity')}
            role="tab"
            aria-selected={activeTab === 'activity'}
            aria-controls="feed-activity-panel"
            id="feed-activity-tab"
            type="button"
          >
            Activity
          </button>
        </div>
      )}

      {activeTab === 'discover' ? (
        <div
          id="feed-discover-panel"
          role="tabpanel"
          aria-labelledby={isAuthenticated ? 'feed-discover-tab' : undefined}
        >
          {showHero && <HeroSection podcasts={heroPodcasts} />}

          <div className={styles.filters}>
            <div className={styles.searchRow}>
              <SearchBar
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder={
                  isPeopleMode
                    ? 'Search people by name, handle, or interest...'
                    : 'Search podcasts by topic, title, or creator...'
                }
              />
              <div className={styles.pillGroup} role="radiogroup" aria-label="Search mode">
                <button
                  className={`${styles.pill} ${searchMode === 'podcasts' ? styles.pillActive : ''}`}
                  onClick={() => handleSearchModeChange('podcasts')}
                  role="radio"
                  aria-checked={searchMode === 'podcasts'}
                  type="button"
                >
                  Podcasts
                </button>
                <button
                  className={`${styles.pill} ${searchMode === 'people' ? styles.pillActive : ''}`}
                  onClick={() => handleSearchModeChange('people')}
                  role="radio"
                  aria-checked={searchMode === 'people'}
                  type="button"
                >
                  People
                </button>
              </div>
            </div>

            {!isPeopleMode && (
              <>
                {tags.length > 0 && (
                  <TagFilter tags={tags} activeTag={activeTag} onTagSelect={handleTagSelect} />
                )}
                <FilterPanel filters={advancedFilters} onChange={handleFiltersChange} />
              </>
            )}
          </div>

          {!isPeopleMode && (
            <div className={styles.toggleRow}>
              <div className={styles.pillGroup} role="radiogroup" aria-label="Feed mode">
                <button
                  className={`${styles.pill} ${mode === 'all' ? styles.pillActive : ''}`}
                  onClick={() => handleModeChange('all')}
                  role="radio"
                  aria-checked={mode === 'all'}
                  type="button"
                >
                  All
                </button>
                <button
                  className={`${styles.pill} ${mode === 'remixes' ? styles.pillActive : ''}`}
                  onClick={() => handleModeChange('remixes')}
                  role="radio"
                  aria-checked={mode === 'remixes'}
                  type="button"
                >
                  Remixes
                </button>
              </div>

              <span className={styles.toggleLabel}>Sort:</span>
              <div className={styles.pillGroup} role="radiogroup" aria-label="Sort order">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={`${styles.pill} ${sort === option.value ? styles.pillActive : ''}`}
                    onClick={() => handleSortChange(option.value)}
                    role="radio"
                    aria-checked={sort === option.value}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showSuggested && <SuggestedFollows currentUserId={currentUserId} />}

          {showTrending && <TrendingSection podcasts={trendingPodcasts} />}

          {isPeopleMode ? (
            <section aria-label="People search results">
              <UserSearchGrid
                users={userResults}
                loading={userLoading && userResults.length === 0}
                emptyMessage={
                  searchQuery.length >= 2
                    ? `No people found for "${searchQuery}"`
                    : 'Type at least 2 characters to search for people'
                }
                isAuthenticated={!!isAuthenticated}
                currentUserId={currentUserId}
              />
            </section>
          ) : (
            <section aria-label="Podcast feed">
              <FeedGrid
                loading={loading && podcasts.length === 0}
                emptyMessage={
                  searchQuery
                    ? `No podcasts found for "${searchQuery}"`
                    : mode === 'remixes'
                      ? 'No remixes yet. Be the first to fork a podcast!'
                      : 'No podcasts yet. Be the first to create one!'
                }
              >
                {podcasts.map((podcast) => (
                  <PodcastCard
                    key={podcast.id}
                    podcast={podcast}
                    feedSort={sort}
                    searchQuery={searchQuery}
                  />
                ))}
              </FeedGrid>
            </section>
          )}

          {((isPeopleMode && userHasMore && userResults.length > 0) ||
            (!isPeopleMode && hasMore && podcasts.length > 0)) && (
            <div className={styles.loadMoreRow}>
              <button
                className={styles.loadMoreBtn}
                onClick={handleLoadMore}
                disabled={isPeopleMode ? userLoading : loading}
                type="button"
              >
                {(isPeopleMode ? userLoading : loading) ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          id="feed-activity-panel"
          role="tabpanel"
          aria-labelledby="feed-activity-tab"
        >
          <ActivityFeed />
        </div>
      )}
    </div>
  );
}
