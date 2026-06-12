'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Glyph, type GlyphName } from '@/components/Glyph';
import { GlassBead } from '@/components/landing/GlassBead';
import { AccountSwitcher } from '@/components/layout/AccountSwitcher';
import { useTheme } from '@/components/providers/ThemeProvider';
import styles from './adminTheme.module.css';

interface AdminShellProps {
  children: React.ReactNode;
}

interface NavItem {
  href: string;
  label: string;
  glyph: GlyphName;
}

const NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', glyph: 'today' },
  { href: '/admin/usage', label: 'Usage & cost', glyph: 'graph' },
  { href: '/admin/providers', label: 'Providers & models', glyph: 'spark' },
  { href: '/admin/users', label: 'Users & access', glyph: 'headset' },
  { href: '/admin/system', label: 'System', glyph: 'gear' },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
}

export function AdminShell({ children }: AdminShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <button
          type="button"
          className={styles.menuButton}
          onClick={() => setOpen(true)}
          aria-label="Open admin navigation"
        >
          <Glyph name="map" size={20} />
        </button>
        <span className={styles.abWord}>sotto</span>
        <span className={styles.abTag}>admin</span>
      </header>

      {open && <div className={styles.overlay} onClick={() => setOpen(false)} aria-hidden="true" />}

      <nav className={`${styles.adminNav} ${open ? styles.open : ''}`} aria-label="Admin navigation">
        <Link href="/dashboard" className={styles.adminBrand} aria-label="Sotto admin home">
          <GlassBead className={styles.brandBead} />
          <span className={styles.abWord}>sotto</span>
          <span className={styles.abTag}>admin</span>
        </Link>

        {NAV.map((n) => {
          const active = isActive(pathname, n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`${styles.anavItem} ${active ? styles.on : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              <Glyph name={n.glyph} size={18} />
              {n.label}
            </Link>
          );
        })}

        <div className={styles.anavFoot}>
          <div className={styles.modeToggle} role="group" aria-label="Color mode">
            <button
              type="button"
              className={resolvedTheme === 'light' ? styles.on : ''}
              onClick={() => setTheme('light')}
              aria-pressed={resolvedTheme === 'light'}
            >
              <Glyph name="sun" size={13} /> Light
            </button>
            <button
              type="button"
              className={resolvedTheme === 'dark' ? styles.on : ''}
              onClick={() => setTheme('dark')}
              aria-pressed={resolvedTheme === 'dark'}
            >
              <Glyph name="moon" size={13} /> Dark
            </button>
          </div>
          <Link href="/dashboard" className={styles.anavBack} onClick={() => setOpen(false)}>
            <Glyph name="back" size={13} /> Back to dashboard
          </Link>
          <AccountSwitcher variant="admin" />
        </div>
      </nav>

      <main className={styles.adminMain}>
        <div className={styles.adminInner}>{children}</div>
      </main>
    </div>
  );
}
