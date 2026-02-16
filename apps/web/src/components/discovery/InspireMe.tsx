'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Sparkles, RefreshCw, Search } from 'lucide-react';
import type { TasteQuestion } from '@sotto/shared';
import type { PodcastSummary } from '@/types/podcast';
import { Spinner } from '@/components/ui/Spinner';
import { InspireQuiz } from './InspireQuiz';
import { InspireTrendingList } from './InspireTrendingList';
import styles from './InspireMe.module.css';

interface InspireMeProps {
  open: boolean;
  onClose: () => void;
  onSelectTopic: (topic: string) => void;
}

type Section = 'forYou' | 'trending' | 'news';
type NewsTimeRange = '1h' | '12h' | '24h' | '1w' | '1m';

const SECTION_LABELS: Record<Section, string> = {
  forYou: 'For You',
  trending: 'Trending',
  news: 'In the News',
};

const TIME_RANGE_LABELS: Record<NewsTimeRange, string> = {
  '1h': 'Past hour',
  '12h': 'Past 12 hours',
  '24h': 'Past 24 hours',
  '1w': 'Past week',
  '1m': 'Past month',
};

function buildUrl(params: Record<string, string | undefined>): string {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) url.set(key, value);
  }
  const qs = url.toString();
  return `/api/inspire/all${qs ? `?${qs}` : ''}`;
}

export function InspireMe({ open, onClose, onSelectTopic }: InspireMeProps) {
  const [activeSection, setActiveSection] = useState<Section>('forYou');
  const [isLoading, setIsLoading] = useState(open);
  const [forYouQuestions, setForYouQuestions] = useState<TasteQuestion[]>([]);
  const [trendingPodcasts, setTrendingPodcasts] = useState<PodcastSummary[]>([]);
  const [newsQuestions, setNewsQuestions] = useState<TasteQuestion[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [newsTimeRange, setNewsTimeRange] = useState<NewsTimeRange>('1w');
  const [isLoadingNews, setIsLoadingNews] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [topicInput, setTopicInput] = useState('');
  const [activeTopic, setActiveTopic] = useState<string | undefined>();
  const topicInputRef = useRef<HTMLInputElement>(null);
  const prevSectionRef = useRef<Section>(activeSection);

  const fetchAll = useCallback((topic?: string) => {
    setIsLoading(true);
    setFetchError(false);

    fetch(buildUrl({ topic }))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        setForYouQuestions(data.forYou ?? []);
        setTrendingPodcasts(data.trending ?? []);
        setNewsQuestions(data.news ?? []);
      })
      .catch(() => setFetchError(true))
      .finally(() => setIsLoading(false));
  }, []);

  // Pre-fetch all tabs on open
  useEffect(() => {
    if (!open) return;
    fetchAll(activeTopic);
  }, [open, fetchAll, activeTopic]);

  const handleSelectTopic = useCallback(
    (topic: string) => {
      onSelectTopic(topic);
      onClose();
    },
    [onSelectTopic, onClose]
  );

  const handleLoadMore = useCallback(
    async (section: 'forYou' | 'news', timeRange?: NewsTimeRange) => {
      setIsLoadingMore(true);
      try {
        const res = await fetch(buildUrl({ section, timeRange, topic: activeTopic }));
        if (!res.ok) return;
        const data = await res.json();
        if (section === 'forYou' && data.forYou) {
          setForYouQuestions(data.forYou);
        } else if (section === 'news' && data.news) {
          setNewsQuestions(data.news);
        }
      } finally {
        setIsLoadingMore(false);
      }
    },
    [activeTopic]
  );

  // Regenerate fresh cards when switching back to forYou or news tabs
  useEffect(() => {
    const prev = prevSectionRef.current;
    prevSectionRef.current = activeSection;
    if (activeSection === 'forYou' && prev !== 'forYou') {
      handleLoadMore('forYou');
    }
    if (activeSection === 'news' && prev !== 'news') {
      handleLoadMore('news', newsTimeRange);
    }
  }, [activeSection, handleLoadMore, newsTimeRange]);

  const handleTimeRangeChange = useCallback(
    async (range: NewsTimeRange) => {
      setNewsTimeRange(range);
      setIsLoadingNews(true);
      try {
        const res = await fetch(buildUrl({ section: 'news', timeRange: range, topic: activeTopic }));
        if (!res.ok) return;
        const data = await res.json();
        if (data.news) {
          setNewsQuestions(data.news);
        }
      } finally {
        setIsLoadingNews(false);
      }
    },
    [activeTopic]
  );

  const handleTopicSubmit = useCallback(() => {
    const trimmed = topicInput.trim() || undefined;
    setActiveTopic(trimmed);
  }, [topicInput]);

  const handleTopicClear = useCallback(() => {
    setTopicInput('');
    setActiveTopic(undefined);
  }, []);

  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Inspire Me">
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerIcon}>
            <Sparkles size={20} aria-hidden="true" />
          </div>
          <h2 className={styles.headerTitle}>Inspire Me</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Tabs + inline topic filter */}
        <div className={styles.tabs} role="tablist" aria-label="Inspiration sections">
          {(Object.keys(SECTION_LABELS) as Section[]).map((section) => (
            <button
              key={section}
              type="button"
              role="tab"
              aria-selected={activeSection === section}
              className={`${styles.tab} ${activeSection === section ? styles.tabActive : ''}`}
              onClick={() => setActiveSection(section)}
            >
              {SECTION_LABELS[section]}
            </button>
          ))}

          {/* Topic filter — lives in the tab row as a chip */}
          <div className={styles.topicChipWrapper}>
            {activeTopic ? (
              <span className={styles.topicChipActive}>
                <Search size={12} aria-hidden="true" />
                {activeTopic}
                <button
                  type="button"
                  className={styles.topicChipClear}
                  onClick={handleTopicClear}
                  aria-label="Clear topic filter"
                >
                  <X size={10} aria-hidden="true" />
                </button>
              </span>
            ) : (
              <label className={styles.topicChip}>
                <Search size={12} aria-hidden="true" />
                <input
                  ref={topicInputRef}
                  type="text"
                  className={styles.topicInput}
                  placeholder="Focus on..."
                  value={topicInput}
                  maxLength={50}
                  onChange={(e) => setTopicInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTopicSubmit();
                  }}
                  disabled={isLoading}
                />
              </label>
            )}
          </div>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {isLoading ? (
            <div className={styles.loadingState}>
              <Spinner size="large" />
              <p>{activeTopic ? `Finding ideas about "${activeTopic}"...` : 'Finding ideas for you...'}</p>
            </div>
          ) : fetchError ? (
            <div className={styles.emptyState}>
              <p>Something went wrong. Please try again.</p>
              <button
                type="button"
                className={styles.retryButton}
                onClick={() => fetchAll(activeTopic)}
              >
                <RefreshCw size={16} aria-hidden="true" />
                Retry
              </button>
            </div>
          ) : activeSection === 'trending' ? (
            <InspireTrendingList
              podcasts={trendingPodcasts}
              onSelectTopic={handleSelectTopic}
            />
          ) : activeSection === 'news' ? (
            <>
              <div className={styles.timeRangeBar}>
                <label htmlFor="news-time-range" className={styles.timeRangeLabel}>
                  Show news from:
                </label>
                <select
                  id="news-time-range"
                  className={styles.timeRangeSelect}
                  value={newsTimeRange}
                  onChange={(e) => handleTimeRangeChange(e.target.value as NewsTimeRange)}
                  disabled={isLoadingNews}
                >
                  {(Object.keys(TIME_RANGE_LABELS) as NewsTimeRange[]).map((range) => (
                    <option key={range} value={range}>
                      {TIME_RANGE_LABELS[range]}
                    </option>
                  ))}
                </select>
              </div>
              {isLoadingNews ? (
                <div className={styles.loadingState}>
                  <Spinner size="large" />
                  <p>Searching for news...</p>
                </div>
              ) : (
                <InspireQuiz
                  key={`news-${newsQuestions[0]?.id ?? 'empty'}`}
                  questions={newsQuestions}
                  onSelectTopic={handleSelectTopic}
                  onLoadMore={() => handleLoadMore('news', newsTimeRange)}
                  isLoadingMore={isLoadingMore}
                />
              )}
            </>
          ) : (
            <InspireQuiz
              key={`forYou-${forYouQuestions[0]?.id ?? 'empty'}`}
              questions={forYouQuestions}
              onSelectTopic={handleSelectTopic}
              onLoadMore={() => handleLoadMore('forYou')}
              isLoadingMore={isLoadingMore}
            />
          )}
        </div>
      </div>
    </div>
  );
}
