'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Search } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import styles from './TopBar.module.css';

interface TopBarUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  id?: string;
}

interface TopBarProps {
  user?: TopBarUser | null;
}

function getInitial(name?: string | null, email?: string | null): string {
  if (name) return name.charAt(0).toUpperCase();
  if (email) return email.charAt(0).toUpperCase();
  return 'U';
}

export function TopBar({ user }: TopBarProps) {
  return (
    <header className={styles.topBar}>
      <Link href="/" className={styles.logo}>
        Sotto
      </Link>
      <nav className={styles.nav}>
        <Link href="/feed">Feed</Link>
        <Link href="/voices">Voices</Link>
        <Link href="/create">Create</Link>
      </nav>
      <div className={styles.actions}>
        <button
          className={styles.searchTrigger}
          onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
          aria-label="Open search"
          type="button"
        >
          <Search size={18} aria-hidden="true" />
        </button>
        <ThemeToggle />
        {user ? (
          <Link
            href="/dashboard"
            className={styles.avatarLink}
            aria-label="Go to dashboard"
          >
            {user.image ? (
              <Image
                src={user.image}
                alt={`${user.name || 'User'}'s avatar`}
                width={32}
                height={32}
                className={styles.avatar}
              />
            ) : (
              <span className={styles.avatarFallback}>{getInitial(user.name, user.email)}</span>
            )}
          </Link>
        ) : (
          <Link href="/auth/login" className={styles.signIn}>
            Sign In
          </Link>
        )}
      </div>
    </header>
  );
}
