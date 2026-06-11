'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { ChevronUp, Check, LogOut } from 'lucide-react';
import { signOut as nextAuthSignOut } from 'next-auth/react';
import { useAuth } from '@/lib/hooks/useAuth';
import { Badge } from '@/components/ui/Badge';
import styles from './AccountSwitcher.module.css';

interface SystemOwnerTarget {
  id: string;
  name: string | null;
  image: string | null;
  handle: string | null;
}

interface AccountSwitcherProps {
  variant?: 'dashboard' | 'admin';
  hasActivePlayer?: boolean;
}

export function AccountSwitcher({ variant = 'dashboard', hasActivePlayer = false }: AccountSwitcherProps) {
  const { user, impersonate, stopImpersonating } = useAuth();
  const [open, setOpen] = useState(false);
  const [systemOwner, setSystemOwner] = useState<SystemOwnerTarget | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role === 'ADMIN';
  const isImpersonating = user?.isImpersonating ?? false;

  useEffect(() => {
    if (!isAdmin) return;
    fetch('/api/v1/admin/impersonate/targets')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.systemOwner) setSystemOwner(data.systemOwner);
      })
      .catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  if (!user) return null;

  const displayName = user.name || user.email || 'User';
  const initials = displayName.charAt(0).toUpperCase();
  const isAdminVariant = variant === 'admin';

  if (!isAdmin) {
    return (
      <div className={`${styles.userSection} ${isAdminVariant ? styles.admin : ''} ${hasActivePlayer ? styles.withPlayer : ''}`}>
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
          <button
            className={styles.signOut}
            onClick={() => nextAuthSignOut({ callbackUrl: '/' })}
            type="button"
            aria-label="Sign out"
          >
            <LogOut size={12} aria-hidden="true" /> Sign out
          </button>
        </div>
      </div>
    );
  }

  const adminIdentity = isImpersonating ? user.originalUser : user;
  const adminName = adminIdentity?.name || 'Admin';

  return (
    <div
      className={`${styles.userSection} ${isAdminVariant ? styles.admin : ''} ${hasActivePlayer ? styles.withPlayer : ''}`}
      ref={ref}
    >
      <button
        className={styles.trigger}
        onClick={() => setOpen(!open)}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Switch account"
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
            <Badge variant="admin">Admin</Badge>
          </div>
          <span className={styles.roleLabel}>
            {isImpersonating ? `Acting as ${user.name}` : 'Administrator'}
          </span>
        </div>
        <ChevronUp
          size={16}
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className={`${styles.popover} ${isAdminVariant ? styles.popoverAdmin : ''}`} role="listbox">
          <button
            className={styles.accountOption}
            onClick={() => {
              if (isImpersonating) {
                stopImpersonating();
              }
              setOpen(false);
            }}
            type="button"
            role="option"
            aria-selected={!isImpersonating}
          >
            <div className={styles.optionAvatar}>
              {adminIdentity?.image ? (
                <Image src={adminIdentity.image} alt="" width={28} height={28} />
              ) : (
                adminName.charAt(0).toUpperCase()
              )}
            </div>
            <div className={styles.optionInfo}>
              <span className={styles.optionName}>{adminName}</span>
              <span className={styles.optionRole}>Your account</span>
            </div>
            {!isImpersonating && <Check size={16} className={styles.check} aria-hidden="true" />}
          </button>

          {systemOwner && (
            <button
              className={styles.accountOption}
              onClick={() => {
                impersonate(systemOwner.id);
                setOpen(false);
              }}
              type="button"
              role="option"
              aria-selected={isImpersonating && user.id === systemOwner.id}
            >
              <div className={styles.optionAvatar}>
                {systemOwner.image ? (
                  <Image src={systemOwner.image} alt="" width={28} height={28} />
                ) : (
                  (systemOwner.name ?? systemOwner.handle ?? 'System').charAt(0).toUpperCase()
                )}
              </div>
              <div className={styles.optionInfo}>
                <span className={styles.optionName}>
                  {systemOwner.name ?? `@${systemOwner.handle ?? 'system'}`}
                </span>
                <span className={styles.optionRole}>System owner</span>
              </div>
              {isImpersonating && user.id === systemOwner.id && (
                <Check size={16} className={styles.check} aria-hidden="true" />
              )}
            </button>
          )}

          <div className={styles.popoverDivider} />
          <button
            className={styles.signOutOption}
            onClick={() => nextAuthSignOut({ callbackUrl: '/' })}
            type="button"
          >
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
