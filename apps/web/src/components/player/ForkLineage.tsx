'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import styles from './ForkLineage.module.css';

interface ForkLineageProps {
  ancestors: Array<{
    id: string;
    title: string;
    user: { id: string; name: string | null; handle: string | null; image: string | null };
  }>;
  forks: Array<{
    id: string;
    title: string;
    remixNote: string | null;
    createdAt: string;
    user: { id: string; name: string | null; handle: string | null; image: string | null };
  }>;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ForkLineage({ ancestors, forks }: ForkLineageProps) {
  const [showAllForks, setShowAllForks] = useState(false);
  const visibleForks = showAllForks ? forks : forks.slice(0, 5);

  if (ancestors.length === 0 && forks.length === 0) return null;

  return (
    <div className={styles.container}>
      {ancestors.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Lineage</h3>
          <nav className={styles.breadcrumb} aria-label="Podcast lineage">
            {ancestors.map((ancestor, index) => {
              const userName = ancestor.user.name || ancestor.user.handle || 'Anonymous';
              return (
                <span key={ancestor.id} className={styles.breadcrumbItem}>
                  <Link href={`/podcast/${ancestor.id}`} className={styles.ancestorLink}>
                    <span className={styles.ancestorTitle}>{ancestor.title}</span>
                    <span className={styles.ancestorUser}>by {userName}</span>
                  </Link>
                  {index < ancestors.length - 1 && (
                    <svg
                      className={styles.breadcrumbArrow}
                      viewBox="0 0 6 10"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        d="M1 1l4 4-4 4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
              );
            })}
            <span className={styles.breadcrumbCurrent}>Current Podcast</span>
          </nav>
        </section>
      )}

      {forks.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            Forks <span className={styles.count}>({forks.length})</span>
          </h3>
          <ul className={styles.forkList}>
            {visibleForks.map((fork) => {
              const userName = fork.user.name || fork.user.handle || 'Anonymous';
              const userImage = fork.user.image || '/default-avatar.png';

              return (
                <li key={fork.id} className={styles.forkItem}>
                  <Link href={`/podcast/${fork.id}`} className={styles.forkLink}>
                    <div className={styles.forkHeader}>
                      <div className={styles.forkUser}>
                        <Image
                          src={userImage}
                          alt={userName}
                          width={32}
                          height={32}
                          className={styles.forkAvatar}
                        />
                        <div className={styles.forkMeta}>
                          <span className={styles.forkUserName}>{userName}</span>
                          <span className={styles.forkDate} suppressHydrationWarning>{formatDate(fork.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <h4 className={styles.forkTitle}>{fork.title}</h4>
                    {fork.remixNote && <p className={styles.remixNote}>{fork.remixNote}</p>}
                  </Link>
                </li>
              );
            })}
          </ul>
          {forks.length > 5 && !showAllForks && (
            <button
              className={styles.showMoreBtn}
              onClick={() => setShowAllForks(true)}
              aria-label={`Show ${forks.length - 5} more forks`}
            >
              Show {forks.length - 5} more forks
            </button>
          )}
        </section>
      )}
    </div>
  );
}
