'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronsUpDown, LogOut, Users } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { resolveProfileAvatar } from '@/lib/avatars';
import styles from './AccountSwitcher.module.css';

interface AccountSwitcherProps {
  variant?: 'dashboard' | 'admin';
  hasActivePlayer?: boolean;
}

/**
 * The active profile in the sidebar footer. Self-hosted and passwordless: it
 * shows who you are with the on-brand animal avatar and links to the
 * "Who's learning?" picker to switch profiles (no login or impersonation).
 */
export function AccountSwitcher({
  variant = 'dashboard',
  hasActivePlayer = false,
}: AccountSwitcherProps) {
  const { user } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!user) return null;

  const displayName = user.name || user.email || 'Learner';
  const avatarUrl = resolveProfileAvatar(user.id, user.image).image;
  const isAdminVariant = variant === 'admin';

  async function exitProfile() {
    setOpen(false);
    try {
      await fetch('/api/v1/profiles/switch', {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch {
      /* Route to the picker either way. */
    }
    router.push('/profiles');
    router.refresh();
  }

  return (
    <div
      className={`${styles.userSection} ${isAdminVariant ? styles.admin : ''} ${hasActivePlayer ? styles.withPlayer : ''}`}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-label="Open profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.avatar}>
          <Image src={avatarUrl} alt="" width={36} height={36} />
        </span>
        <div className={styles.userInfo}>
          <div className={styles.userNameRow}>
            <span className={styles.userName}>{displayName}</span>
          </div>
          <span className={styles.roleLabel}>Profile menu</span>
        </div>
        <ChevronsUpDown
          size={15}
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          className={`${styles.popover} ${isAdminVariant ? styles.popoverAdmin : ''}`}
          role="menu"
        >
          <Link
            href="/profiles"
            className={styles.accountOption}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <span className={styles.optionAvatar}>
              <Users size={16} aria-hidden="true" />
            </span>
            <span className={styles.optionInfo}>
              <span className={styles.optionName}>Switch profiles</span>
              <span className={styles.optionRole}>Choose who is learning</span>
            </span>
          </Link>

          <div className={styles.popoverDivider} role="separator" />

          <button
            type="button"
            className={styles.signOutOption}
            role="menuitem"
            onClick={() => void exitProfile()}
          >
            <LogOut size={16} aria-hidden="true" />
            Exit profile
          </button>
        </div>
      )}
    </div>
  );
}
