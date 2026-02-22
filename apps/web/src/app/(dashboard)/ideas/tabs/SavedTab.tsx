'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BookmarkX } from 'lucide-react';
import { PodcastCard } from '@/components/feed/PodcastCard';
import type { PodcastSummary } from '@/types/podcast';
import styles from './SavedTab.module.css';

interface SavedTabProps {
  podcasts: PodcastSummary[];
}

export function SavedTab({ podcasts: initialPodcasts }: SavedTabProps) {
  const [podcasts, setPodcasts] = useState(initialPodcasts);
  const [unsavingId, setUnsavingId] = useState<string | null>(null);

  const handleUnsave = async (podcastId: string) => {
    setUnsavingId(podcastId);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/save`, { method: 'DELETE' });
      if (res.ok) {
        setPodcasts((prev) => prev.filter((p) => p.id !== podcastId));
      }
    } finally {
      setUnsavingId(null);
    }
  };

  if (podcasts.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p className={styles.emptyText}>
          No saved podcasts yet. Save podcasts from any podcast page.
        </p>
        <Link href="/feed" className={styles.emptyLink}>
          Discover podcasts
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {podcasts.map((podcast) => (
        <div key={podcast.id} className={styles.cardWrapper}>
          <PodcastCard podcast={podcast} variant="compact" />
          <button
            type="button"
            className={styles.unsaveBtn}
            onClick={() => handleUnsave(podcast.id)}
            disabled={unsavingId === podcast.id}
            aria-label={`Remove ${podcast.title} from saved`}
          >
            <BookmarkX size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
