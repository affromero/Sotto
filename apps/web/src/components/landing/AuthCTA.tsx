'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { useHasMounted } from '@/lib/hooks/useHasMounted';
import { useWaitlist } from './WaitlistProvider';
import { WaitlistForm } from './WaitlistForm';
import styles from './AuthCTA.module.css';

interface AuthCTAProps {
  source: 'hero' | 'cta';
}

export function AuthCTA({ source }: AuthCTAProps) {
  const { isAuthenticated } = useAuth();
  const mounted = useHasMounted();
  const { submitted } = useWaitlist();

  if (mounted && isAuthenticated) {
    return (
      <div className={styles.ctas}>
        <Link href="/feed" className={styles.btnPrimary}>
          Explore the Feed
        </Link>
        <Link href="/dashboard" className={styles.btnGhost}>
          Dashboard
        </Link>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className={styles.success}>
        You&apos;re on the list! We&apos;ll email you when your spot is ready.
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <WaitlistForm source={source} />
      <div className={styles.links}>
        <Link href="/feed" className={styles.link}>Explore the Feed</Link>
        <Link href="/auth/login" className={styles.link}>Sign In</Link>
      </div>
    </div>
  );
}
