'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, Network, Settings, Smartphone, Shield } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import styles from './ProfileMenu.module.css';

function getInitial(name?: string | null, email?: string | null): string {
  if (name) return name.charAt(0).toUpperCase();
  if (email) return email.charAt(0).toUpperCase();
  return 'U';
}

/**
 * The signed-in learner's avatar in the header, opening one unified menu to
 * their learning, account, a device-connection helper, and (for the owner)
 * admin destinations. "Switch user" signs out back to the Netflix-style profile
 * picker; "Log out" returns to the public landing.
 */
export function ProfileMenu() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const name = user.name || user.email || 'Learner';
  const isAdmin = user.role === 'ADMIN';

  return (
    <div className={styles.root} ref={ref}>
      <button
        className={styles.trigger}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open your menu"
        type="button"
      >
        {user.image ? (
          <Image src={user.image} alt="" width={32} height={32} className={styles.avatar} />
        ) : (
          <span className={styles.avatarFallback}>{getInitial(user.name, user.email)}</span>
        )}
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.header}>
            {user.image ? (
              <Image src={user.image} alt="" width={40} height={40} className={styles.headerAvatar} />
            ) : (
              <span className={styles.headerFallback}>{getInitial(user.name, user.email)}</span>
            )}
            <span className={styles.headerName}>{name}</span>
          </div>

          <Link href="/learn" className={styles.item} role="menuitem" onClick={() => setOpen(false)}>
            <BookOpen size={16} aria-hidden="true" /> Your courses
          </Link>
          <Link href="/memory" className={styles.item} role="menuitem" onClick={() => setOpen(false)}>
            <Network size={16} aria-hidden="true" /> Memory graph
          </Link>
          <Link href="/settings" className={styles.item} role="menuitem" onClick={() => setOpen(false)}>
            <Settings size={16} aria-hidden="true" /> Account &amp; appearance
          </Link>
          <Link href="/settings/devices" className={styles.item} role="menuitem" onClick={() => setOpen(false)}>
            <Smartphone size={16} aria-hidden="true" /> Connect a device
          </Link>

          {isAdmin && (
            <>
              <div className={styles.divider} role="separator" />
              <Link href="/admin" className={styles.item} role="menuitem" onClick={() => setOpen(false)}>
                <Shield size={16} aria-hidden="true" /> Admin dashboard
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
