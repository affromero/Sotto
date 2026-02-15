import Link from 'next/link';
import { PodcastCard } from '@/components/feed/PodcastCard';
import type { PodcastSummary } from '@/types/podcast';
import styles from './TrendingSection.module.css';

interface TrendingSectionProps {
  podcasts: PodcastSummary[];
  onPlay?: (id: string) => void;
}

export function TrendingSection({ podcasts, onPlay }: TrendingSectionProps) {
  if (podcasts.length === 0) {
    return null;
  }

  return (
    <section className={styles.root} aria-label="Trending podcasts">
      <div className={styles.header}>
        <h2 className={styles.heading}>Trending</h2>
        <Link href="/feed?sort=trending" className={styles.seeAll}>
          See all
        </Link>
      </div>
      <div className={styles.scrollContainer}>
        {podcasts.map((podcast) => (
          <div key={podcast.id} className={styles.cardWrapper}>
            <PodcastCard
              podcast={podcast}
              variant="compact"
              onPlay={onPlay}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
