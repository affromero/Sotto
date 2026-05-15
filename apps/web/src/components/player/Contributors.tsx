'use client';

import Image from 'next/image';
import type { VoiceTrackContributor } from '@sotto/shared';
import styles from './Contributors.module.css';

interface ContributorWithCount {
  contributor: VoiceTrackContributor;
  count: number;
}

interface ContributorsProps {
  contributors: ContributorWithCount[];
}

export function Contributors({ contributors }: ContributorsProps) {
  if (contributors.length === 0) return null;

  return (
    <div className={styles.root}>
      <h3 className={styles.heading}>Contributors</h3>
      <div className={styles.list}>
        {contributors.map(({ contributor, count }) => (
          <div key={contributor.id} className={styles.contributor}>
            {contributor.image ? (
              <Image
                src={contributor.image}
                alt={contributor.name || ''}
                width={28}
                height={28}
                className={styles.avatar}
              />
            ) : (
              <span className={styles.avatarPlaceholder}>
                {(contributor.name || '?')[0].toUpperCase()}
              </span>
            )}
            <span className={styles.name}>
              {contributor.handle ? `@${contributor.handle}` : contributor.name}
            </span>
            {count > 1 && <span className={styles.count}>{count}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
