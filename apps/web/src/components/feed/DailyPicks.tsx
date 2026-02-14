'use client';

import { useState, useCallback } from 'react';
import { RefreshCw, MessageCircle } from 'lucide-react';
import { PodcastCard } from './PodcastCard';
import type { PodcastSummary } from '@/types/podcast';
import type { RecommendationSignals } from '@/lib/providers/ml';
import styles from './DailyPicks.module.css';

interface Pick {
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
  score: number;
  signals: RecommendationSignals;
  explanation: string;
  category: string;
}

interface PickCategory {
  label: string;
  podcasts: Pick[];
}

interface DailyPicksProps {
  initialPicks: Pick[];
  initialCategories: PickCategory[];
  initialMessage?: string;
}

function pickToPodcastSummary(pick: Pick): PodcastSummary {
  return {
    id: pick.podcastId,
    title: pick.title,
    topic: pick.topic,
    status: 'READY',
    visibility: 'PUBLIC',
    audioUrl: pick.audioUrl,
    duration: pick.duration,
    playCount: pick.playCount,
    likeCount: pick.likeCount,
    forkCount: pick.forkCount,
    createdAt: pick.createdAt,
    source: 'WEB',
    isHumanContent: false,
    forkedFromId: null,
    user: {
      ...pick.user,
      handle: pick.user.handle || null,
    },
    tags: pick.tags,
  };
}

export function DailyPicks({ initialPicks, initialCategories, initialMessage }: DailyPicksProps) {
  const [picks, setPicks] = useState(initialPicks);
  const [categories, setCategories] = useState(initialCategories);
  const [message, setMessage] = useState(initialMessage);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshBatch, setRefreshBatch] = useState(0);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshBatch }),
      });
      if (res.ok) {
        const data = await res.json();
        setPicks(data.picks);
        setCategories(data.categories);
        setMessage(data.message);
        setRefreshBatch(data.refreshBatch);
      }
    } catch {
      // Silent failure
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshBatch]);

  if (picks.length === 0) {
    return (
      <section className={styles.root}>
        <div className={styles.header}>
          <h2 className={styles.title}>Your Picks</h2>
        </div>
        <div className={styles.empty}>
          <MessageCircle size={32} />
          <p>Listen to a few podcasts and we&apos;ll start curating picks for you.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.root}>
      <div className={styles.header}>
        <h2 className={styles.title}>Your Picks</h2>
        <button
          className={styles.refreshButton}
          onClick={handleRefresh}
          disabled={isRefreshing}
          type="button"
          aria-label="Refresh picks"
        >
          <RefreshCw size={16} className={isRefreshing ? styles.spinning : ''} />
          <span>{isRefreshing ? 'Refreshing...' : 'Not feeling these?'}</span>
        </button>
      </div>

      {message && <p className={styles.message}>{message}</p>}

      {categories
        .filter((cat) => cat.podcasts.length > 0)
        .map((category) => (
          <div key={category.label} className={styles.category}>
            <h3 className={styles.categoryLabel}>{category.label}</h3>
            <div className={styles.categoryGrid}>
              {category.podcasts.map((pick, idx) => (
                <div key={pick.podcastId} className={styles.pickCard}>
                  <PodcastCard
                    podcast={pickToPodcastSummary(pick)}
                    position={idx}
                    feedSort="picks"
                  />
                  <p className={styles.explanation}>{pick.explanation}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
    </section>
  );
}
