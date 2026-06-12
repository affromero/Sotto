'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { useHasMounted } from '@/lib/hooks/useHasMounted';
import { getPublicGithubUrl } from '@/lib/public-links';
import styles from './LandingCTA.module.css';

const GITHUB_URL = getPublicGithubUrl() ?? 'https://github.com/affromero/Sotto';

interface LandingCTAProps {
  /** Whether to render the secondary ghost link. */
  withGhost?: boolean;
  /** Public managed showcase: send visitors through the mock welcome flow. */
  demoMode?: boolean;
}

const ArrowIcon = () => (
  <svg
    className={styles.arrow}
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/**
 * Auth-aware call to action.
 *
 * - Demo       → "Try the welcome flow" → /welcome
 * - Signed in  → "Continue your course" → /learn
 * - Signed out → "Start your course" → /auth/login (the profile picker)
 * - Secondary  → "View on GitHub" (the open-source repo)
 */
export function LandingCTA({ withGhost = false, demoMode = false }: LandingCTAProps) {
  const { isAuthenticated } = useAuth();
  const mounted = useHasMounted();
  const signedIn = mounted && isAuthenticated;
  const primaryHref = demoMode ? '/welcome' : signedIn ? '/learn' : '/auth/login';
  const primaryLabel = demoMode
    ? 'Try the welcome flow'
    : signedIn
      ? 'Continue your course'
      : 'Start your course';

  return (
    <div className={styles.actions}>
      <Link href={primaryHref} className={styles.btnPrimary}>
        {primaryLabel}
        <ArrowIcon />
      </Link>
      {withGhost && (
        <a href={GITHUB_URL} className={styles.btnGhost} target="_blank" rel="noopener noreferrer">
          View on GitHub
        </a>
      )}
    </div>
  );
}
