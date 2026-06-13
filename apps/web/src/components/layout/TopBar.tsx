'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Search } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { ProfileMenu } from './ProfileMenu';
import styles from './TopBar.module.css';

export function TopBar() {
  return (
    <header className={styles.topBar}>
      <Link href="/" className={styles.logo}>
        <Image src="/brand/sotto-mark.svg" alt="" width={24} height={24} className={styles.logoMark} unoptimized />
        Sotto
      </Link>
      <nav className={styles.nav}>
        <Link href="/learn">Learn</Link>
        <Link href="/memory">Memory</Link>
      </nav>
      <div className={styles.actions}>
        <button
          className={styles.searchTrigger}
          onClick={() =>
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
          }
          aria-label="Open search"
          type="button"
        >
          <Search size={18} aria-hidden="true" />
        </button>
        <ThemeToggle />
        <ProfileMenu />
      </div>
    </header>
  );
}
