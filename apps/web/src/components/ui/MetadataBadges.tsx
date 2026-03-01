'use client';

import { getPodcastBadges, type PodcastBadge } from '@sotto/shared';
import type { PodcastSummary } from '@/types/podcast';
import styles from './MetadataBadges.module.css';

type BadgeCategory = PodcastBadge['category'];

interface MetadataBadgesProps {
  podcast: Pick<
    PodcastSummary,
    'source' | 'isHumanContent' | 'sourcePlatform' | 'aiProvider' | 'aiModel' | 'ttsProvider' | 'ttsModel' | 'language'
  >;
  categories?: BadgeCategory[];
  compact?: boolean;
}

export function MetadataBadges({ podcast, categories, compact }: MetadataBadgesProps) {
  const allBadges = getPodcastBadges(podcast);
  const badges = categories ? allBadges.filter((b) => categories.includes(b.category)) : allBadges;

  if (badges.length === 0) return null;

  return (
    <div className={`${styles.badges} ${compact ? styles.compact : ''}`}>
      {badges.map((badge) => (
        <span
          key={`${badge.category}-${badge.label}`}
          className={`${styles.badge} ${styles[badge.variant]}`}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}
