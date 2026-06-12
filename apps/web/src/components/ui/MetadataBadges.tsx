'use client';

import { getEpisodeBadges, type EpisodeBadge } from '@sotto/shared';
import type { EpisodeSummary } from '@/types/episode';
import styles from './MetadataBadges.module.css';

type BadgeCategory = EpisodeBadge['category'];

interface MetadataBadgesProps {
  episode: Pick<
    EpisodeSummary,
    'source' | 'sourcePlatform' | 'aiProvider' | 'aiModel' | 'ttsProvider' | 'ttsModel' | 'language'
  >;
  categories?: BadgeCategory[];
  compact?: boolean;
}

export function MetadataBadges({ episode, categories, compact }: MetadataBadgesProps) {
  const allBadges = getEpisodeBadges(episode);
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
