'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ListMusic, X } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { podcastUrl } from '@/lib/urls';
import type { PodcastSummary } from '@/types/podcast';
import styles from './CollectionDetail.module.css';

interface CollectionItem extends PodcastSummary {
  addedAt: string;
  order: number;
}

interface CollectionUser {
  id: string;
  name: string | null;
  handle: string | null;
  image: string | null;
}

interface CollectionDetailProps {
  id: string;
  name: string;
  description: string | null;
  podcastCount: number;
  createdAt: string;
  user: CollectionUser;
  items: CollectionItem[];
  isOwner: boolean;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatCount(count: number): string {
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return count.toString();
}

export function CollectionDetail({
  id,
  name,
  description,
  podcastCount: initialPodcastCount,
  createdAt,
  user,
  items: initialItems,
  isOwner,
}: CollectionDetailProps) {
  const [items, setItems] = useState(initialItems);
  const [podcastCount, setPodcastCount] = useState(initialPodcastCount);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const { user: currentUser } = useAuth();

  const handleRemoveItem = useCallback(
    async (podcastId: string) => {
      setRemovingId(podcastId);
      try {
        const res = await fetch(`/api/collections/${id}/items`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ podcastId }),
        });

        if (res.ok) {
          setItems((prev) => prev.filter((item) => item.id !== podcastId));
          setPodcastCount((c) => Math.max(0, c - 1));
        }
      } finally {
        setRemovingId(null);
      }
    },
    [id]
  );

  return (
    <div className={styles.root}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerIcon} aria-hidden="true">
          <ListMusic size={28} />
        </div>
        <div className={styles.headerContent}>
          <h1 className={styles.title}>{name}</h1>
          {description && <p className={styles.description}>{description}</p>}

          <div className={styles.meta}>
            <span className={styles.creator}>
              <div className={styles.creatorAvatar}>
                {user.image ? (
                  <Image
                    src={user.image}
                    alt={user.name || 'Creator'}
                    width={24}
                    height={24}
                    className={styles.creatorAvatarImg}
                  />
                ) : (
                  <span className={styles.creatorAvatarFallback}>
                    {(user.name || user.handle || 'U')[0].toUpperCase()}
                  </span>
                )}
              </div>
              <span>{user.name || user.handle || 'Anonymous'}</span>
            </span>
            <span className={styles.metaDot} aria-hidden="true" />
            <span className={styles.stat}>
              <ListMusic size={14} aria-hidden="true" />
              {formatCount(podcastCount)} {podcastCount === 1 ? 'podcast' : 'podcasts'}
            </span>
            <span className={styles.metaDot} aria-hidden="true" />
            <time className={styles.date} dateTime={createdAt}>
              {formatDate(createdAt)}
            </time>
          </div>
        </div>
      </header>

      {/* Podcast list */}
      {items.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyText}>
            {isOwner
              ? 'This collection is empty. Add podcasts from any podcast page.'
              : 'This collection is empty.'}
          </p>
        </div>
      ) : (
        <ul className={styles.list} role="list" aria-label="Collection podcasts">
          {items.map((item) => (
            <li key={item.id} className={styles.item}>
              <Link
                href={podcastUrl(item, item.user.handle)}
                className={styles.itemLink}
                aria-label={`${item.title} - ${item.topic}`}
              >
                <div className={styles.itemContent}>
                  <h3 className={styles.itemTitle}>{item.title}</h3>
                  <p className={styles.itemTopic}>{item.topic}</p>
                  <div className={styles.itemMeta}>
                    <span className={styles.itemCreator}>{item.user.name || 'Anonymous'}</span>
                    <span className={styles.itemSep} aria-hidden="true">
                      ·
                    </span>
                    <span>{formatDuration(item.duration)}</span>
                    {currentUser?.id === item.user.id && (
                      <>
                        <span className={styles.itemSep} aria-hidden="true">
                          ·
                        </span>
                        <span>{formatCount(item.playCount)} plays</span>
                      </>
                    )}
                    {item.tags.length > 0 && (
                      <>
                        <span className={styles.itemSep} aria-hidden="true">
                          ·
                        </span>
                        <span className={styles.itemTag}>{item.tags[0].name}</span>
                      </>
                    )}
                  </div>
                </div>
              </Link>
              {isOwner && (
                <button
                  type="button"
                  className={styles.removeBtn}
                  onClick={() => handleRemoveItem(item.id)}
                  disabled={removingId === item.id}
                  aria-label={`Remove ${item.title} from collection`}
                >
                  <X size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
