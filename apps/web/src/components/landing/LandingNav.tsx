'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { useHasMounted } from '@/lib/hooks/useHasMounted';
import styles from './LandingNav.module.css';

export function LandingNav() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const mounted = useHasMounted();
  const [navSolid, setNavSolid] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setNavSolid(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className={`${styles.nav} ${navSolid ? styles.navSolid : ''}`}
      role="navigation"
      aria-label="Main"
    >
      <div className={styles.navInner}>
        <Link href="/" className={styles.navLogo} aria-label="Sotto home">
          Sotto
        </Link>
        <div className={styles.navRight}>
          <Link href="/create" className={styles.navSign}>
            Create
          </Link>
          <Link href="/feed" className={styles.navCta}>
            Explore Feed
          </Link>
          {mounted && !authLoading && (
            isAuthenticated ? (
              <Link href="/dashboard" className={styles.navSign}>
                Dashboard
              </Link>
            ) : (
              <Link href="/auth/login" className={styles.navSign}>
                Sign In
              </Link>
            )
          )}
          <button
            type="button"
            className={`${styles.burger} ${menuOpen ? styles.burgerOpen : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
    </nav>
  );
}
