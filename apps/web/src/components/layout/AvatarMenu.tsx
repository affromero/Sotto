'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  Network,
  Settings,
  Smartphone,
  Shield,
  Users,
  LogOut,
  Sun,
  Moon,
  ChevronDown,
} from 'lucide-react';
import { useTheme } from '@/components/providers/ThemeProvider';
import { resolveProfileAvatar } from '@/lib/avatars';
import { langLabel } from '@/lib/languages';
import type { HouseholdProfile } from '@/lib/profiles';
import styles from './AvatarMenu.module.css';

interface AvatarMenuUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: 'USER' | 'ADMIN';
}

type ProfileDTO = HouseholdProfile & { isActive: boolean };

function metaLine(p: ProfileDTO | undefined): string | null {
  if (!p?.primaryCourse) return null;
  return `${langLabel(p.primaryCourse.targetLang)} · ${p.primaryCourse.level}`;
}

/**
 * The active profile's avatar in the header, opening a Netflix-style menu: a
 * switch-profile row, a light/dark toggle, and links to courses, memory,
 * settings, device pairing, and (owner only) the admin console.
 */
export function AvatarMenu({ user }: { user: AvatarMenuUser }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [household, setHousehold] = useState<ProfileDTO[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/v1/profiles', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { profiles: ProfileDTO[] } | null) => {
        if (active && data?.profiles) setHousehold(data.profiles);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const avatarUrl = resolveProfileAvatar(user.id, user.image).image;
  const name = user.name || user.email || 'Learner';
  const isOwner = user.role === 'ADMIN';
  const active = household?.find((p) => p.isActive);
  const others = household?.filter((p) => !p.isActive) ?? [];
  const meta = metaLine(active);
  const isDark = resolvedTheme === 'dark';

  async function switchTo(profileId: string) {
    setOpen(false);
    try {
      const res = await fetch('/api/v1/profiles/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ profileId }),
      });
      if (res.ok) {
        router.push('/learn');
        router.refresh();
      }
    } catch {
      /* keep the current profile on failure */
    }
  }

  async function exitProfile() {
    setOpen(false);
    try {
      await fetch('/api/v1/profiles/switch', {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch {
      /* The redirect still lands on the picker; stale cookies can be cleared there later. */
    }
    router.push('/profiles');
    router.refresh();
  }

  return (
    <div className={styles.root} ref={ref}>
      <button
        type="button"
        className={`${styles.trigger} ${open ? styles.open : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open your menu"
      >
        <span className={styles.who}>
          <b>{name}</b>
          {meta && <span>{meta}</span>}
        </span>
        <span className={styles.avatar}>
          <Image src={avatarUrl} alt="" width={30} height={30} />
        </span>
        <ChevronDown size={14} className={styles.chev} aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className={styles.scrim} onClick={() => setOpen(false)} aria-hidden="true" />
          <div className={styles.menu} role="menu">
            <div className={styles.head}>
              <span className={styles.headAvatar}>
                <Image src={avatarUrl} alt="" width={42} height={42} />
              </span>
              <div className={styles.headText}>
                <div className={styles.headName}>{name}</div>
                {meta && <div className={styles.headMeta}>{meta}</div>}
              </div>
              {isOwner && <span className={styles.ownerBadge}>owner</span>}
            </div>

            {others.length > 0 && (
              <div className={styles.switch}>
                <div className={styles.switchLabel}>Switch profile</div>
                <div className={styles.faces}>
                  {others.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={styles.face}
                      title={p.name}
                      aria-label={`Switch to ${p.name}`}
                      onClick={() => switchTo(p.id)}
                    >
                      <Image src={p.avatarUrl} alt="" width={44} height={44} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.list}>
              <div className={styles.modeRow}>
                <span className={styles.modeLabel}>
                  {isDark ? (
                    <Moon size={17} aria-hidden="true" />
                  ) : (
                    <Sun size={17} aria-hidden="true" />
                  )}
                  {isDark ? 'Dark' : 'Light'} mode
                </span>
                <button
                  type="button"
                  className={`${styles.modeSwitch} ${isDark ? styles.modeSwitchDark : ''}`}
                  onClick={() => setTheme(isDark ? 'light' : 'dark')}
                  aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  <i />
                </button>
              </div>

              <div className={styles.sep} role="separator" />

              <Link
                href="/learn"
                className={styles.item}
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <BookOpen size={18} aria-hidden="true" /> Your courses
              </Link>
              <Link
                href="/memory"
                className={styles.item}
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <Network size={18} aria-hidden="true" /> Memory graph
              </Link>
              <Link
                href="/settings"
                className={styles.item}
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <Settings size={18} aria-hidden="true" /> Account &amp; appearance
              </Link>
              <Link
                href="/settings/devices"
                className={styles.item}
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <Smartphone size={18} aria-hidden="true" /> Connect a device
              </Link>
              {isOwner && (
                <Link
                  href="/admin"
                  className={styles.item}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  <Shield size={18} aria-hidden="true" /> Admin console
                </Link>
              )}

              <div className={styles.sep} role="separator" />

              <button
                type="button"
                className={styles.item}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  router.push('/profiles');
                }}
              >
                <Users size={18} aria-hidden="true" /> Who&rsquo;s learning?
              </button>
              <button
                type="button"
                className={`${styles.item} ${styles.exitItem}`}
                role="menuitem"
                onClick={() => void exitProfile()}
              >
                <LogOut size={18} aria-hidden="true" /> Exit profile
              </button>
            </div>

            <div className={styles.foot}>
              <span>Sotto</span>
              <span>self hosted</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
