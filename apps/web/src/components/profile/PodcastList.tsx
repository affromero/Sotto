'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { PodcastSummary } from '@/types/podcast';
import styles from './PodcastList.module.css';

interface PodcastListProps {
  podcasts: PodcastSummary[];
  loading?: boolean;
  emptyMessage?: string;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatStat(count: number): string {
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return count.toString();
}

function SkeletonItem() {
  return (
    <div className={styles.item} aria-hidden="true">
      <div className={`${styles.skeletonTitle} ${styles.skeleton}`} />
      <div className={`${styles.skeletonTopic} ${styles.skeleton}`} />
      <div className={styles.meta}>
        <div className={`${styles.skeletonMeta} ${styles.skeleton}`} />
      </div>
    </div>
  );
}

export function PodcastList({
  podcasts,
  loading = false,
  emptyMessage = 'No podcasts yet',
}: PodcastListProps) {
  const { user } = useAuth();

  if (loading) {
    return (
      <div className={styles.root} role="status" aria-label="Loading podcasts">
        <SkeletonItem />
        <SkeletonItem />
        <SkeletonItem />
      </div>
    );
  }

  if (podcasts.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ul className={styles.root} role="list" aria-label="Podcasts">
      {podcasts.map((podcast) => (
        <li key={podcast.id} className={styles.item}>
          <a
            href={`/podcast/${podcast.id}`}
            className={styles.link}
            aria-label={`${podcast.title} - ${podcast.topic}`}
          >
            <div className={styles.content}>
              <h3 className={styles.title}>{podcast.title}</h3>
              <p className={styles.topic}>{podcast.topic}</p>
              {podcast.tags.length > 0 && (
                <div className={styles.tags}>
                  {podcast.tags.map((tag) => (
                    <span key={tag.id} className={styles.tag}>
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className={styles.meta}>
              <span className={styles.duration}>
                {formatDuration(podcast.duration)}
              </span>
              {user?.id === podcast.user.id && (
                <>
                  <span className={styles.separator} aria-hidden="true">
                    ·
                  </span>
                  <span className={styles.stat} title="Plays">
                    {formatStat(podcast.playCount)} plays
                  </span>
                  <span className={styles.separator} aria-hidden="true">
                    ·
                  </span>
                  <span className={styles.stat} title="Likes">
                    {formatStat(podcast.likeCount)} likes
                  </span>
                  {podcast.forkCount > 0 && (
                    <>
                      <span className={styles.separator} aria-hidden="true">
                        ·
                      </span>
                      <span className={styles.stat} title="Forks">
                        {formatStat(podcast.forkCount)} forks
                      </span>
                    </>
                  )}
                </>
              )}
              <span className={styles.separator} aria-hidden="true">
                ·
              </span>
              <time className={styles.date} dateTime={podcast.createdAt}>
                {formatDate(podcast.createdAt)}
              </time>
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}
