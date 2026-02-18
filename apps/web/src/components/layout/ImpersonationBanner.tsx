'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import styles from './ImpersonationBanner.module.css';

export function ImpersonationBanner() {
  const { user, stopImpersonating } = useAuth();
  const isImpersonating = user?.isImpersonating ?? false;

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--impersonation-banner-height',
      isImpersonating ? '40px' : '0px'
    );
    return () => {
      document.documentElement.style.setProperty('--impersonation-banner-height', '0px');
    };
  }, [isImpersonating]);

  if (!isImpersonating) return null;

  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <span className={styles.text}>
        Acting as <strong>{user?.name ?? 'Unknown'}</strong>
      </span>
      <button className={styles.switchBack} onClick={stopImpersonating} type="button">
        Switch back
      </button>
    </div>
  );
}
