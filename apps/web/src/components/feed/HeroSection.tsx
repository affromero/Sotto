'use client';

import { PodcastCard } from '@/components/feed/PodcastCard';
import type { PodcastSummary } from '@/types/podcast';
import styles from './HeroSection.module.css';

interface HeroSectionProps {
  podcasts: PodcastSummary[];
  onPlay?: (id: string) => void;
}

export function HeroSection({ podcasts, onPlay }: HeroSectionProps) {
  if (podcasts.length === 0) return null;

  const [featured, ...rest] = podcasts;
  const sidePodcasts = rest.slice(0, 2);

  return (
    <section className={styles.root} aria-label="Featured podcasts">
      <div className={styles.grid}>
        <PodcastCard
          podcast={featured}
          variant="featured"
          onPlay={onPlay}
        />
        {sidePodcasts.map((podcast) => (
          <PodcastCard
            key={podcast.id}
            podcast={podcast}
            onPlay={onPlay}
          />
        ))}
      </div>
    </section>
  );
}
