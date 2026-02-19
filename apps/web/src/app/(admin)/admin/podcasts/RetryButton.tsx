'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

export function RetryButton({ podcastId }: { podcastId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleRetry = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/generate`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Retry failed');
        return;
      }
      router.refresh();
    } catch {
      alert('Retry failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      className={styles.retryButton}
      onClick={handleRetry}
      disabled={loading}
    >
      {loading ? 'Retrying...' : 'Retry'}
    </button>
  );
}
