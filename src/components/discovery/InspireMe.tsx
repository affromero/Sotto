'use client';

import { useCallback, useEffect, useState } from 'react';
import { TopicCard } from './TopicCard';
import styles from './InspireMe.module.css';

interface TopicSuggestion {
  title: string;
  category: string;
  hook: string;
}

interface InspireData {
  forYou: TopicSuggestion[];
  trending: TopicSuggestion[];
  inTheNews: TopicSuggestion[];
}

interface InspireMeProps {
  open: boolean;
  onClose: () => void;
  onSelectTopic: (topic: string) => void;
}

type View = 'sections' | 'drill';

export function InspireMe({ open, onClose, onSelectTopic }: InspireMeProps) {
  const [data, setData] = useState<InspireData | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>('sections');
  const [drillCategory, setDrillCategory] = useState('');
  const [drillTitle, setDrillTitle] = useState('');
  const [drillTopics, setDrillTopics] = useState<TopicSuggestion[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (data) return;
    setLoading(true);
    try {
      const response = await fetch('/api/inspire');
      if (response.ok) {
        setData(await response.json());
      }
    } catch {
      // Silently fail — sections will be empty
    } finally {
      setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open, fetchData]);

  useEffect(() => {
    if (!open) {
      setView('sections');
      setDrillTopics([]);
    }
  }, [open]);

  const handleDrillDown = async (topic: TopicSuggestion) => {
    setView('drill');
    setDrillCategory(topic.category);
    setDrillTitle(topic.title);
    setDrillLoading(true);

    try {
      const response = await fetch('/api/inspire/drill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: topic.category, parentTitle: topic.title }),
      });
      if (response.ok) {
        const result = await response.json();
        setDrillTopics(result.subtopics);
      }
    } catch {
      // Stay on drill view with empty list
    } finally {
      setDrillLoading(false);
    }
  };

  const handleSelectTopic = (title: string) => {
    onSelectTopic(title);
    onClose();
  };

  const handleBack = () => {
    setView('sections');
    setDrillTopics([]);
  };

  if (!open) return null;

  const hasForYou = data && data.forYou.length > 0;
  const hasTrending = data && data.trending.length > 0;
  const hasNews = data && data.inTheNews.length > 0;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Inspire Me">
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          {view === 'drill' ? (
            <button type="button" className={styles.backButton} onClick={handleBack}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          ) : (
            <div className={styles.headerIcon}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3l1.6 5.1H19l-4.2 3 1.6 5.1L12 13.2l-4.4 3 1.6-5.1-4.2-3h5.4z" />
              </svg>
            </div>
          )}
          <h2 className={styles.headerTitle}>{view === 'drill' ? drillCategory : 'Inspire Me'}</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {loading && (
            <div className={styles.loadingState}>
              <div className={styles.spinner} />
              <span>Finding topics for you...</span>
            </div>
          )}

          {!loading && view === 'sections' && (
            <>
              {hasForYou && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>For You</h3>
                  <div className={styles.topicList}>
                    {data.forYou.map((topic, i) => (
                      <TopicCard
                        key={i}
                        title={topic.title}
                        hook={topic.hook}
                        category={topic.category}
                        onClick={() => handleDrillDown(topic)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {hasTrending && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>Trending on Sotto</h3>
                  <div className={styles.topicList}>
                    {data.trending.map((topic, i) => (
                      <TopicCard
                        key={i}
                        title={topic.title}
                        hook={topic.hook}
                        category={topic.category}
                        onClick={() => handleSelectTopic(topic.title)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {hasNews && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>In the News</h3>
                  <div className={styles.topicList}>
                    {data.inTheNews.map((topic, i) => (
                      <TopicCard
                        key={i}
                        title={topic.title}
                        hook={topic.hook}
                        category={topic.category}
                        onClick={() => handleDrillDown(topic)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {!hasForYou && !hasTrending && !hasNews && (
                <div className={styles.emptyState}>
                  <p>No suggestions available right now. Try describing your idea in the chat!</p>
                </div>
              )}
            </>
          )}

          {!loading && view === 'drill' && (
            <section className={styles.section}>
              <p className={styles.drillContext}>{drillTitle}</p>
              {drillLoading ? (
                <div className={styles.loadingState}>
                  <div className={styles.spinner} />
                  <span>Finding specific topics...</span>
                </div>
              ) : (
                <div className={styles.topicList}>
                  {drillTopics.map((topic, i) => (
                    <TopicCard
                      key={i}
                      title={topic.title}
                      hook={topic.hook}
                      variant="compact"
                      onClick={() => handleSelectTopic(topic.title)}
                    />
                  ))}
                  {drillTopics.length === 0 && (
                    <div className={styles.emptyState}>
                      <p>No subtopics found. Try tapping the topic above to use it directly.</p>
                      <button
                        type="button"
                        className={styles.useTopicButton}
                        onClick={() => handleSelectTopic(drillTitle)}
                      >
                        Use &ldquo;{drillTitle}&rdquo;
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
