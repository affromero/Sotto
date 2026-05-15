'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BookmarkX, Bookmark } from 'lucide-react';
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
        <Bookmark size={48} className={styles.emptyIcon} aria-hidden="true" />
        <h3 className={styles.emptyTitle}>No saved podcasts</h3>
        <p className={styles.emptyText}>Save podcasts from any podcast page to find them here.</p>
        <Link href="/create" className={styles.emptyLink}>
          Create a podcast
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
