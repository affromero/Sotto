'use client';

import { Sparkles } from 'lucide-react';
import { PodcastCard } from '@/components/feed/PodcastCard';
import type { PodcastSummary } from '@/types/podcast';
import styles from './InspireTrendingList.module.css';

interface InspireTrendingListProps {
  podcasts: PodcastSummary[];
  onSelectTopic: (topic: string) => void;
}

export function InspireTrendingList({ podcasts, onSelectTopic }: InspireTrendingListProps) {
  if (podcasts.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>No trending podcasts yet. Be the first to create one!</p>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {podcasts.map((podcast) => (
        <div key={podcast.id} className={styles.item}>
          <PodcastCard podcast={podcast} variant="compact" />
          <button
            type="button"
            className={styles.makeBtn}
            onClick={() => onSelectTopic(podcast.topic)}
            aria-label={`Make a podcast like ${podcast.title}`}
          >
            <Sparkles size={14} aria-hidden="true" />
            Make one like this
          </button>
        </div>
      ))}
    </div>
  );
}
