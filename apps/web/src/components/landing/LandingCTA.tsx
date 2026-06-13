'use client';

import Link from 'next/link';
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
 * Primary call to action. Sotto is fully self-hosted with no login, so the
 * button goes straight to the course. The managed showcase (demoMode) sends
 * visitors through the mock welcome flow instead.
 */
export function LandingCTA({ withGhost = false, demoMode = false }: LandingCTAProps) {
  const primaryHref = demoMode ? '/welcome' : '/learn';
  const primaryLabel = demoMode ? 'Try the welcome flow' : 'Start your course';

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
