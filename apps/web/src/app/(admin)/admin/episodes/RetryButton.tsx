'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useEpisodeStatus } from '@/lib/hooks/useEpisodeStatus';
import styles from './page.module.css';

export function RetryButton({ episodeId }: { episodeId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [deliveryPending, setDeliveryPending] = useState(false);
  const [retryUncertain, setRetryUncertain] = useState(false);
  const [allowSharedCredential, setUseAdminCredits] = useState(true);
  useEpisodeStatus({
    episodeId: deliveryPending ? episodeId : null,
    onStatusChange: (event) => {
      if (['FAILED', 'READY', 'SCRIPT_READY', 'DRAFT'].includes(event.status)) {
        setDeliveryPending(false);
        router.refresh();
      }
    },
  });

  const handleRetry = async () => {
    setLoading(true);
    try {
      const url = `/api/v1/episodes/${episodeId}/generate${allowSharedCredential ? '?allowSharedCredential=true' : ''}`;
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Retry failed');
        if (data.deliveryPending === true) {
          setDeliveryPending(true);
          router.refresh();
        }
        return;
      }
      router.refresh();
    } catch {
      alert('The retry could not be confirmed. Reload the page to check its status.');
      setRetryUncertain(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.retryRow}>
      <label className={styles.adminCreditsLabel}>
        <input
          type="checkbox"
          checked={allowSharedCredential}
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
        disabled={loading || deliveryPending || retryUncertain}
      >
        {loading ? 'Retrying...' : 'Retry'}
      </button>
    </div>
  );
}
