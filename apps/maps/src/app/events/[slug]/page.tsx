'use client';

import { use } from 'react';
import styles from './page.module.css';

export default function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  return (
    <div className={styles.root}>
      <div className={styles.placeholder}>
        <h1 className={styles.title}>{slug.replace(/-/g, ' ')}</h1>
        <p className={styles.message}>Full-screen MapSequence coming soon.</p>
        <p className={styles.hint}>
          This page will render an animated cinematic fly-through of the event&apos;s key locations.
        </p>
      </div>
    </div>
  );
}
