'use client';

import { useCallback, useState } from 'react';

interface ManageSubscriptionButtonProps {
  className?: string;
}

export function ManageSubscriptionButton({ className }: ManageSubscriptionButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <button type="button" className={className} onClick={handleClick} disabled={loading}>
      {loading ? 'Loading...' : 'Manage Subscription'}
    </button>
  );
}
