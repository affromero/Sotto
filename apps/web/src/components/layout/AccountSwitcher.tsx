'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ChevronsUpDown } from 'lucide-react';
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
export function AccountSwitcher({ variant = 'dashboard', hasActivePlayer = false }: AccountSwitcherProps) {
  const { user } = useAuth();
  if (!user) return null;

  const displayName = user.name || user.email || 'Learner';
  const avatarUrl = resolveProfileAvatar(user.id, user.image).image;
  const isAdminVariant = variant === 'admin';

  return (
    <div
      className={`${styles.userSection} ${isAdminVariant ? styles.admin : ''} ${hasActivePlayer ? styles.withPlayer : ''}`}
    >
      <Link href="/profiles" className={styles.trigger} aria-label="Switch profile">
        <span className={styles.avatar}>
          <Image src={avatarUrl} alt="" width={36} height={36} />
        </span>
        <div className={styles.userInfo}>
          <div className={styles.userNameRow}>
            <span className={styles.userName}>{displayName}</span>
          </div>
          <span className={styles.roleLabel}>Switch profile</span>
        </div>
        <ChevronsUpDown size={15} className={styles.chevron} aria-hidden="true" />
      </Link>
    </div>
  );
}
