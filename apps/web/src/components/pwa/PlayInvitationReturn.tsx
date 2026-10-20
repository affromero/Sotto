'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createPlayInviteLink, type PlayInviteEnvelope } from '@sotto/shared';
import {
  clearPlayInvitationIntent,
  readPlayInvitationIntent,
} from '@/components/play/client/intent';
import styles from './PlayInvitationReturn.module.css';

export function PlayInvitationReturn() {
  const pathname = usePathname();
  const router = useRouter();
  const [invitation, setInvitation] = useState<PlayInviteEnvelope | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = readPlayInvitationIntent();
        setInvitation(saved);
        if (
          !saved ||
          saved.serverUrl !== location.origin ||
          !['/', '/access'].includes(pathname) ||
          !window.matchMedia('(display-mode: standalone)').matches
        )
          return;
        const link = new URL(createPlayInviteLink(saved.serverUrl, saved.code));
        router.replace(`${link.pathname}${link.search}`);
      } catch {
        // Optional navigation memory cannot prevent ordinary app navigation.
        // The invitation page reports storage failures before sending admission.
        setInvitation(null);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [pathname, router]);
  if (!invitation || pathname === '/play/join' || pathname.startsWith('/play/rooms/')) return null;
  return (
    <aside className={styles.root} aria-label="Saved game invitation">
      <a href={createPlayInviteLink(invitation.serverUrl, invitation.code)}>
        Return to your game invitation
      </a>
      <button
        type="button"
        aria-label="Dismiss saved game invitation"
        onClick={() => {
          try {
            clearPlayInvitationIntent();
            setInvitation(null);
          } catch {
            setInvitation(null);
          }
        }}
      >
        Dismiss
      </button>
    </aside>
  );
}
