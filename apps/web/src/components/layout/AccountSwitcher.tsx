'use client';

import Image from 'next/image';
import { useAuth } from '@/lib/hooks/useAuth';
import styles from './AccountSwitcher.module.css';

interface AccountSwitcherProps {
  variant?: 'dashboard' | 'admin';
  hasActivePlayer?: boolean;
}

/**
 * Self-hosted single learner: this just shows who you are. There is no login,
 * no account switching, and no impersonation.
 */
export function AccountSwitcher({ variant = 'dashboard', hasActivePlayer = false }: AccountSwitcherProps) {
  const { user } = useAuth();
  if (!user) return null;

  const displayName = user.name || user.email || 'Learner';
  const initials = displayName.charAt(0).toUpperCase();
  const isAdminVariant = variant === 'admin';

  return (
    <div
      className={`${styles.userSection} ${isAdminVariant ? styles.admin : ''} ${hasActivePlayer ? styles.withPlayer : ''}`}
    >
      <div className={styles.avatar}>
        {user.image ? (
          <Image src={user.image} alt={`${displayName}'s avatar`} width={32} height={32} />
        ) : (
          initials
        )}
      </div>
      <div className={styles.userInfo}>
        <div className={styles.userNameRow}>
          <span className={styles.userName}>{displayName}</span>
        </div>
      </div>
    </div>
  );
}
