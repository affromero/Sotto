'use client';

import { useTransition } from 'react';
import styles from './CollectNowButton.module.css';

export function CollectNowButton() {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await fetch('/api/v1/admin/r2-usage/collect', { method: 'POST' });
    });
  }

  return (
    <button
      className={styles.collectButton}
      onClick={handleClick}
      disabled={isPending}
      aria-label="Collect R2 usage data now"
    >
      {isPending ? 'Collecting…' : 'Collect Now'}
    </button>
  );
}
