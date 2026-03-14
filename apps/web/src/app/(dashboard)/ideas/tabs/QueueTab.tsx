'use client';

import { useState } from 'react';
import Link from 'next/link';
import { X, ListMusic } from 'lucide-react';
import styles from './QueueTab.module.css';

interface QueuePodcast {
  id: string;
  title: string;
  topic: string;
  duration: number | null;
  user: { id: string; name: string | null; image: string | null };
}

interface QueueItem {
  id: string;
  position: number;
  podcastId: string;
  podcast: QueuePodcast;
}

interface QueueTabProps {
  items: QueueItem[];
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

export function QueueTab({ items: initialItems }: QueueTabProps) {
  const [items, setItems] = useState(initialItems);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleRemove = async (podcastId: string) => {
    setRemovingId(podcastId);
    try {
      const res = await fetch(`/api/queue?podcastId=${podcastId}`, { method: 'DELETE' });
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.podcastId !== podcastId));
      }
    } finally {
      setRemovingId(null);
    }
  };

  if (items.length === 0) {
    return (
      <div className={styles.emptyState}>
        <ListMusic size={48} className={styles.emptyIcon} aria-hidden="true" />
        <h3 className={styles.emptyTitle}>Your queue is empty</h3>
        <p className={styles.emptyText}>
          Add podcasts from any podcast page to listen later.
        </p>
        <Link href="/feed" className={styles.emptyLink}>
          Browse the feed
        </Link>
      </div>
    );
  }

  return (
    <ol className={styles.list}>
      {items.map((item, index) => {
        const duration = formatDuration(item.podcast.duration);
        return (
          <li key={item.id} className={styles.item}>
            <span className={styles.position}>{index + 1}</span>
            <div className={styles.itemContent}>
              <Link href={`/podcast/${item.podcast.id}`} className={styles.itemLink}>
                <span className={styles.itemTitle}>{item.podcast.title}</span>
                <span className={styles.itemTopic}>{item.podcast.topic}</span>
              </Link>
              <div className={styles.itemMeta}>
                <span className={styles.itemCreator}>
                  {item.podcast.user.name || 'Anonymous'}
                </span>
                {duration && <span className={styles.itemDuration}>{duration}</span>}
              </div>
            </div>
            <button
              type="button"
              className={styles.removeBtn}
              onClick={() => handleRemove(item.podcastId)}
              disabled={removingId === item.podcastId}
              aria-label={`Remove ${item.podcast.title} from queue`}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
