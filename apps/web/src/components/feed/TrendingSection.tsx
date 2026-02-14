import Link from 'next/link';
import { Play } from 'lucide-react';
import type { PodcastSummary } from '@/types/podcast';
import styles from './TrendingSection.module.css';

interface TrendingSectionProps {
  podcasts: PodcastSummary[];
  onPlay?: (id: string) => void;
}

function formatCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

function MiniCard({
  podcast,
  onPlay,
}: {
  podcast: PodcastSummary;
  onPlay?: (id: string) => void;
}) {
  return (
    <article className={styles.miniCard}>
      <Link
        href={`/podcast/${podcast.id}`}
        className={styles.miniCardLink}
        aria-label={`Listen to ${podcast.title} by ${podcast.user.name || 'Unknown'}`}
      >
        <h4 className={styles.miniTitle}>{podcast.title}</h4>
        <span className={styles.miniCreator}>
          {podcast.user.name || 'Anonymous'}
        </span>
        <div className={styles.miniStats}>
          <Play size={12} aria-hidden="true" />
          <span>{formatCount(podcast.playCount)}</span>
        </div>
      </Link>
      {onPlay && podcast.audioUrl && (
        <button
          type="button"
          className={styles.miniPlayButton}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPlay(podcast.id);
          }}
          aria-label={`Play ${podcast.title}`}
        >
          <Play size={16} aria-hidden="true" />
        </button>
      )}
    </article>
  );
}

export function TrendingSection({ podcasts, onPlay }: TrendingSectionProps) {
  if (podcasts.length === 0) {
    return null;
  }

  return (
    <section className={styles.root} aria-label="Trending podcasts">
      <h2 className={styles.heading}>Trending</h2>
      <div className={styles.scrollContainer}>
        {podcasts.map((podcast) => (
          <MiniCard key={podcast.id} podcast={podcast} onPlay={onPlay} />
        ))}
      </div>
    </section>
  );
}
