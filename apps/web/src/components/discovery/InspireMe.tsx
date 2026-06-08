'use client';

import { useState, useEffect, useCallback, useRef, type MutableRefObject } from 'react';
import { X, Sparkles, RefreshCw, Search } from 'lucide-react';
import type { TasteQuestion, InspireSection } from '@sotto/shared';
import { INSPIRE_SECTION_LABELS } from '@sotto/shared';
import type { PodcastSummary } from '@/types/podcast';
import { InspireQuiz } from './InspireQuiz';
import { InspireTrendingList } from './InspireTrendingList';
import styles from './InspireMe.module.css';

interface InspireMeProps {
  open: boolean;
  onClose: () => void;
  onSelectTopic: (topic: string) => void;
  aiModel?: string;
  prefetchRef?: MutableRefObject<Promise<Response> | null>;
}

type Section = InspireSection;

function buildUrl(params: Record<string, string | undefined>): string {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) url.set(key, value);
  }
  const qs = url.toString();
  return `/api/inspire/all${qs ? `?${qs}` : ''}`;
}

interface SseEvent {
  section?: Section;
  data?: TasteQuestion[] | PodcastSummary[];
  done?: boolean;
  error?: string;
}

export function InspireMe({ open, onClose, onSelectTopic, aiModel, prefetchRef }: InspireMeProps) {
  const [activeSection, setActiveSection] = useState<Section>('forYou');
  const [sectionsLoading, setSectionsLoading] = useState<Record<Section, boolean>>({
    forYou: false,
    trending: false,
    curiosity: false,
  });
  const [forYouQuestions, setForYouQuestions] = useState<TasteQuestion[]>([]);
  const [trendingPodcasts, setTrendingPodcasts] = useState<PodcastSummary[]>([]);
  const [curiosityQuestions, setCuriosityQuestions] = useState<TasteQuestion[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [topicInput, setTopicInput] = useState('');
  const [activeTopic, setActiveTopic] = useState<string | undefined>();
  const topicInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isAnyLoading = sectionsLoading.forYou || sectionsLoading.trending || sectionsLoading.curiosity;

  const fetchAll = useCallback((topic?: string) => {
    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSectionsLoading({ forYou: true, trending: true, curiosity: true });
    setFetchError(false);

    const url = buildUrl({ topic, model: aiModel });

    // Use prefetched response if available and no topic filter (prefetch has no topic)
    const prefetchPromise = !topic && prefetchRef?.current ? prefetchRef.current : null;
    if (prefetchPromise) prefetchRef!.current = null; // consume once

    const responsePromise = prefetchPromise ?? fetch(url, { signal: controller.signal });

    responsePromise
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const contentType = res.headers.get('content-type') ?? '';

        // JSON response = all sections cached, returned at once
        if (contentType.includes('application/json')) {
          const data = await res.json();
          setForYouQuestions(data.forYou ?? []);
          setTrendingPodcasts(data.trending ?? []);
          setCuriosityQuestions(data.curiosity ?? []);
          setSectionsLoading({ forYou: false, trending: false, curiosity: false });
          return;
        }

        // SSE response — read progressively
        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep the last incomplete line in the buffer
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const event: SseEvent = JSON.parse(jsonStr);

              if (event.done) {
                setSectionsLoading({ forYou: false, trending: false, curiosity: false });
                return;
              }

              if (event.section && event.data) {
                switch (event.section) {
                  case 'trending':
                    setTrendingPodcasts(event.data as PodcastSummary[]);
                    break;
                  case 'forYou':
                    setForYouQuestions(event.data as TasteQuestion[]);
                    break;
                  case 'curiosity':
                    setCuriosityQuestions(event.data as TasteQuestion[]);
                    break;
                }
                setSectionsLoading((prev) => ({ ...prev, [event.section!]: false }));
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }

        // Stream ended without explicit done event
        setSectionsLoading({ forYou: false, trending: false, curiosity: false });
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        setFetchError(true);
        setSectionsLoading({ forYou: false, trending: false, curiosity: false });
      });

    return () => controller.abort();
  }, [aiModel]);

  // Pre-fetch all tabs on open
  useEffect(() => {
    if (!open) return;
    const cleanup = fetchAll(activeTopic);
    return cleanup;
  }, [open, fetchAll, activeTopic]);

  // Cleanup on unmount
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const handleSelectTopic = useCallback(
    (topic: string) => {
      onSelectTopic(topic);
      onClose();
    },
    [onSelectTopic, onClose]
  );

  const handleLoadMore = useCallback(
    async (section: 'forYou' | 'curiosity') => {
      setIsLoadingMore(true);
      try {
        const res = await fetch(buildUrl({ section, topic: activeTopic, model: aiModel }));
        if (!res.ok) return;
        const data = await res.json();
        if (section === 'forYou' && data.forYou) {
          setForYouQuestions(data.forYou);
        } else if (section === 'curiosity' && data.curiosity) {
          setCuriosityQuestions(data.curiosity);
        }
      } finally {
        setIsLoadingMore(false);
      }
    },
    [activeTopic, aiModel]
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

  const activeTabLoading = sectionsLoading[activeSection];

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
          {(Object.keys(INSPIRE_SECTION_LABELS) as Section[]).map((sec) => (
            <button
              key={sec}
              type="button"
              role="tab"
              aria-selected={activeSection === sec}
              className={`${styles.tab} ${activeSection === sec ? styles.tabActive : ''} ${sectionsLoading[sec] && activeSection !== sec ? styles.tabLoading : ''}`}
              onClick={() => setActiveSection(sec)}
            >
              {INSPIRE_SECTION_LABELS[sec]}
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
                  disabled={isAnyLoading}
                />
              </label>
            )}
          </div>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {fetchError ? (
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
          ) : activeTabLoading ? (
            <div className={styles.skeletonGrid} aria-busy="true" aria-label="Loading suggestions">
              <p className={styles.skeletonHint}>
                {activeSection === 'trending'
                  ? 'Loading trending podcasts...'
                  : activeSection === 'curiosity'
                    ? 'Discovering curiosities...'
                    : activeTopic
                      ? `Finding ideas about "${activeTopic}"...`
                      : 'Finding ideas for you...'}
              </p>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={styles.skeletonCard}>
                  <div className={styles.skeletonLine} style={{ width: '85%' }} />
                  <div className={styles.skeletonLine} style={{ width: '60%' }} />
                  <div className={styles.skeletonChips}>
                    <div className={styles.skeletonChip} />
                    <div className={styles.skeletonChip} />
                  </div>
                </div>
              ))}
            </div>
          ) : activeSection === 'trending' ? (
            <InspireTrendingList
              podcasts={trendingPodcasts}
              onSelectTopic={handleSelectTopic}
            />
          ) : activeSection === 'curiosity' ? (
            <InspireQuiz
              key={`curiosity-${curiosityQuestions[0]?.id ?? 'empty'}`}
              questions={curiosityQuestions}
              onSelectTopic={handleSelectTopic}
              onLoadMore={() => handleLoadMore('curiosity')}
              isLoadingMore={isLoadingMore}
            />
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
