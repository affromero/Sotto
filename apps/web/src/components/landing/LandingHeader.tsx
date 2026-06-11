'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { useHasMounted } from '@/lib/hooks/useHasMounted';
import { getPublicGithubUrl } from '@/lib/public-links';
import { GlassBead } from './GlassBead';
import styles from './LandingHeader.module.css';

const GITHUB_URL = getPublicGithubUrl() ?? 'https://github.com/affromero/Sotto';

const NAV_LINKS = [
  { href: '/about', label: 'About' },
  { href: '/download', label: 'Download' },
] as const;

/**
 * Top navigation for the landing page. Auth-aware: signed-in learners see a
 * "Dashboard" entry; signed-out visitors see "Sign in". Hydration-safe via
 * useHasMounted so the server render is stable.
 */
export function LandingHeader() {
  const { isAuthenticated } = useAuth();
  const mounted = useHasMounted();
  const [menuOpen, setMenuOpen] = useState(false);

  const signedIn = mounted && isAuthenticated;

  return (
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="Primary">
        <Link href="/" className={styles.wordmark} aria-label="Sotto home">
          <GlassBead className={styles.wordmarkBead} />
          <span className={styles.wordmarkText}>sotto</span>
        </Link>

        <button
          type="button"
          className={styles.menuToggle}
          aria-expanded={menuOpen}
          aria-controls="landing-nav-links"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className={styles.menuBar} />
          <span className={styles.menuBar} />
        </button>

        <div
          id="landing-nav-links"
          className={`${styles.links} ${menuOpen ? styles.linksOpen : ''}`}
        >
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={styles.link}>
              {link.label}
            </Link>
          ))}
          <a
            href={GITHUB_URL}
            className={styles.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>

          {signedIn ? (
            <Link href="/dashboard" className={styles.navCta}>
              Dashboard
            </Link>
          ) : (
            <Link href="/auth/login" className={styles.navCta}>
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
