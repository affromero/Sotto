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

  return (
    <section className={styles.root} aria-label="Featured podcasts">
      <div className={styles.grid}>
        {podcasts.slice(0, 3).map((podcast) => (
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
