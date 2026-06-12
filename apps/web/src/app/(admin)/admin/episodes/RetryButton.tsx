'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

export function RetryButton({ episodeId }: { episodeId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [useAdminCredits, setUseAdminCredits] = useState(true);

  const handleRetry = async () => {
    setLoading(true);
    try {
      const url = `/api/v1/episodes/${episodeId}/generate${useAdminCredits ? '?useAdminCredits=true' : ''}`;
      const res = await fetch(url, { method: 'POST' });
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
    <div className={styles.retryRow}>
      <label className={styles.adminCreditsLabel}>
        <input
          type="checkbox"
          checked={useAdminCredits}
          onChange={(e) => setUseAdminCredits(e.target.checked)}
          disabled={loading}
          className={styles.adminCreditsCheckbox}
        />
        Admin credits
      </label>
      <button
        type="button"
        className={styles.retryButton}
        onClick={handleRetry}
        disabled={loading}
      >
        {loading ? 'Retrying...' : 'Retry'}
      </button>
    </div>
  );
}
