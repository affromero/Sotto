'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, GripVertical, ListMusic } from 'lucide-react';
import styles from './ListeningQueue.module.css';

interface QueueItem {
  id: string;
  podcastId: string;
  position: number;
  source: string;
  podcast: {
    id: string;
    title: string;
    topic: string;
    duration: number | null;
    audioUrl: string | null;
    user: { id: string; name: string | null };
    tags: Array<{ id: string; name: string; slug: string }>;
  };
}

interface ListeningQueueProps {
  onPlayPodcast?: (podcastId: string, audioUrl: string) => void;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const mins = Math.round(seconds / 60);
  return `${mins}m`;
}

export function ListeningQueue({ onPlayPodcast }: ListeningQueueProps) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadQueue() {
      try {
        const res = await fetch('/api/queue');
        if (res.ok && !cancelled) {
          const data = await res.json();
          setQueue(data.queue || []);
        }
      } catch {
        // Silent failure
      }
    }
    loadQueue();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRemove = useCallback(async (podcastId: string) => {
    try {
      await fetch(`/api/queue?podcastId=${podcastId}`, { method: 'DELETE' });
      setQueue((prev) => prev.filter((item) => item.podcastId !== podcastId));
    } catch {
      // Silent failure
    }
  }, []);

  const handlePlay = useCallback(
    (item: QueueItem) => {
      if (onPlayPodcast && item.podcast.audioUrl) {
        onPlayPodcast(item.podcastId, item.podcast.audioUrl);
      }
    },
    [onPlayPodcast]
  );

  if (queue.length === 0 && !isOpen) return null;

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Listening queue (${queue.length} items)`}
      >
        <ListMusic size={18} />
        <span className={styles.badge}>{queue.length}</span>
      </button>

      {isOpen && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>Up Next</h3>
            <span className={styles.count}>{queue.length}/10</span>
          </div>

          {queue.length === 0 ? (
            <p className={styles.empty}>
              Your queue is empty. Add podcasts from your picks or search.
            </p>
          ) : (
            <ul className={styles.list}>
              {queue.map((item) => (
                <li key={item.id} className={styles.item}>
                  <GripVertical size={14} className={styles.grip} aria-hidden="true" />
                  <button
                    type="button"
                    className={styles.itemContent}
                    onClick={() => handlePlay(item)}
                    aria-label={`Play ${item.podcast.title}`}
                  >
                    <span className={styles.itemTitle}>{item.podcast.title}</span>
                    <span className={styles.itemMeta}>
                      {item.podcast.user.name || 'Unknown'}
                      {item.podcast.duration ? ` · ${formatDuration(item.podcast.duration)}` : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => handleRemove(item.podcastId)}
                    aria-label={`Remove ${item.podcast.title} from queue`}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
