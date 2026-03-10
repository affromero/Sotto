'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SearchBar } from '@/components/feed/SearchBar';
import { TagFilter } from '@/components/feed/TagFilter';
import { FilterPanel, type AdvancedFilters } from '@/components/feed/FilterPanel';
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

const SORT_VALID = new Set<SortOption>(['recent', 'popular', 'trending', 'most_forked']);
const MODE_VALID = new Set<ModeOption>(['all', 'remixes']);
const TAB_VALID = new Set<FeedTab>(['discover', 'activity']);
const SEARCH_MODE_VALID = new Set<SearchMode>(['podcasts', 'people']);

export function FeedClient({ initialPodcasts, trendingPodcasts, tags, isAuthenticated, currentUserId }: FeedClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Read initial state from URL params
  const initialTab = TAB_VALID.has(searchParams.get('tab') as FeedTab) ? (searchParams.get('tab') as FeedTab) : 'discover';
  const initialSort = SORT_VALID.has(searchParams.get('sort') as SortOption) ? (searchParams.get('sort') as SortOption) : 'recent';
  const initialMode = MODE_VALID.has(searchParams.get('mode') as ModeOption) ? (searchParams.get('mode') as ModeOption) : 'all';
  const initialSearchMode = SEARCH_MODE_VALID.has(searchParams.get('search') as SearchMode) ? (searchParams.get('search') as SearchMode) : 'podcasts';

  const [activeTab, setActiveTab] = useState<FeedTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '');
  const [activeTag, setActiveTag] = useState<string | undefined>(searchParams.get('tag') ?? undefined);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>({});
  const [podcasts, setPodcasts] = useState(initialPodcasts);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialPodcasts.length >= 24);
  const [sort, setSort] = useState<SortOption>(initialSort);
  const [mode, setMode] = useState<ModeOption>(initialMode);

  // People search state
  const [searchMode, setSearchMode] = useState<SearchMode>(initialSearchMode);
  const [userResults, setUserResults] = useState<UserDiscoveryResult[]>([]);
  const [userLoading, setUserLoading] = useState(false);
  const [userHasMore, setUserHasMore] = useState(false);
  const [userPage, setUserPage] = useState(1);

  // Sync state to URL (omit default values for clean URLs)
  const syncUrl = useCallback((overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const state: Record<string, string | undefined> = {
      tab: activeTab !== 'discover' ? activeTab : undefined,
      q: searchQuery || undefined,
      tag: activeTag,
      sort: sort !== 'recent' ? sort : undefined,
      mode: mode !== 'all' ? mode : undefined,
      search: searchMode !== 'podcasts' ? searchMode : undefined,
      ...overrides,
    };
    for (const [key, value] of Object.entries(state)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    router.replace(`/feed${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [activeTab, searchQuery, activeTag, sort, mode, searchMode, router]);

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
        if (filters.language) params.set('language', filters.language);
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
      // Debounce URL update for search input
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        syncUrl({ q: value || undefined });
      }, 300);
    },
    [activeTag, advancedFilters, sort, mode, fetchPodcasts, fetchUsers, searchMode, syncUrl]
  );

  const handleSearchModeChange = useCallback(
    (newMode: SearchMode) => {
      setSearchMode(newMode);
      if (newMode === 'people' && searchQuery.length >= 2) {
        fetchUsers(searchQuery);
      } else if (newMode === 'podcasts') {
        fetchPodcasts(searchQuery, activeTag, advancedFilters, sort, mode);
      }
      syncUrl({ search: newMode !== 'podcasts' ? newMode : undefined });
    },
    [searchQuery, activeTag, advancedFilters, sort, mode, fetchPodcasts, fetchUsers, syncUrl]
  );

  const handleTagSelect = useCallback(
    (slug: string | undefined) => {
      setActiveTag(slug);
      fetchPodcasts(searchQuery, slug, advancedFilters, sort, mode);
      syncUrl({ tag: slug });
    },
    [searchQuery, advancedFilters, sort, mode, fetchPodcasts, syncUrl]
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
      syncUrl({ sort: newSort !== 'recent' ? newSort : undefined });
    },
    [searchQuery, activeTag, advancedFilters, mode, fetchPodcasts, syncUrl]
  );

  const handleModeChange = useCallback(
    (newMode: ModeOption) => {
      setMode(newMode);
      fetchPodcasts(searchQuery, activeTag, advancedFilters, sort, newMode);
      syncUrl({ mode: newMode !== 'all' ? newMode : undefined });
    },
    [searchQuery, activeTag, advancedFilters, sort, fetchPodcasts, syncUrl]
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
  const showTrending = isDefaultView && searchMode === 'podcasts' && trendingPodcasts.length > 0;
  const showSuggested = isAuthenticated && currentUserId && isDefaultView && searchMode === 'podcasts';
  const isPeopleMode = searchMode === 'people';

  return (
    <div className={styles.feedContent}>
      {isAuthenticated && (
        <div className={styles.feedTabs} role="tablist" aria-label="Feed tabs">
          <button
            className={`${styles.feedTab} ${activeTab === 'discover' ? styles.feedTabActive : ''}`}
            onClick={() => { setActiveTab('discover'); syncUrl({ tab: undefined }); }}
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
            onClick={() => { setActiveTab('activity'); syncUrl({ tab: 'activity' }); }}
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
          className={styles.discoverPanel}
        >
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
