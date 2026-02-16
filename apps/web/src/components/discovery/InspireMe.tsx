'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Sparkles } from 'lucide-react';
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

export function InspireMe({ open, onClose, onSelectTopic }: InspireMeProps) {
  const [activeSection, setActiveSection] = useState<Section>('forYou');
  const [isLoading, setIsLoading] = useState(false);
  const [forYouQuestions, setForYouQuestions] = useState<TasteQuestion[]>([]);
  const [trendingPodcasts, setTrendingPodcasts] = useState<PodcastSummary[]>([]);
  const [newsQuestions, setNewsQuestions] = useState<TasteQuestion[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [newsTimeRange, setNewsTimeRange] = useState<NewsTimeRange>('1w');
  const [isLoadingNews, setIsLoadingNews] = useState(false);

  // Pre-fetch all tabs on open
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setIsLoading(true);

    fetch('/api/inspire/all')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setForYouQuestions(data.forYou ?? []);
        setTrendingPodcasts(data.trending ?? []);
        setNewsQuestions(data.news ?? []);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

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
        const params = new URLSearchParams({ section });
        if (timeRange) params.set('timeRange', timeRange);
        const res = await fetch(`/api/inspire/all?${params}`);
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
    []
  );

  const handleTimeRangeChange = useCallback(
    async (range: NewsTimeRange) => {
      setNewsTimeRange(range);
      setIsLoadingNews(true);
      try {
        const res = await fetch(`/api/inspire/all?section=news&timeRange=${range}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.news) {
          setNewsQuestions(data.news);
        }
      } finally {
        setIsLoadingNews(false);
      }
    },
    []
  );

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

        {/* Tabs */}
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
        </div>

        {/* Content */}
        <div className={styles.content}>
          {isLoading ? (
            <div className={styles.loadingState}>
              <Spinner size="large" />
              <p>Finding ideas for you...</p>
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
