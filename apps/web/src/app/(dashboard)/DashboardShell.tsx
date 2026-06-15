'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileNav } from '@/components/layout/MobileNav';
import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import { NotificationDropdown } from '@/components/notifications/NotificationDropdown';
import { AvatarMenu } from '@/components/layout/AvatarMenu';
import { PushPrompt } from '@/components/notifications/PushPrompt';
import { usePushSubscription } from '@/lib/hooks/usePushSubscription';
import { Menu } from 'lucide-react';
import styles from './DashboardShell.module.css';

interface DashboardShellProps {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    role: 'USER' | 'ADMIN';
  };
  hasEpisodes?: boolean;
  children: React.ReactNode;
}

export function DashboardShell({ user, hasEpisodes = false, children }: DashboardShellProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pushDismissed, setPushDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('sotto:push-prompt-dismissed') === 'true';
  });
  const player = usePlayer();
  const hasActivePlayer = !!player.episodeId;
  const { pushState, subscribe } = usePushSubscription();

  return (
    <div className={styles.layout}>
      <Sidebar
        currentPath={pathname}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        hasEpisodes={hasEpisodes}
        hasActivePlayer={hasActivePlayer}
        user={user}
      />

      <div className={styles.main}>
        <header className={styles.topBar}>
          <button
            className={styles.menuButton}
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation menu"
            type="button"
          >
            <Menu size={24} aria-hidden="true" />
          </button>
          <span className={styles.logo}>Sotto</span>
          <div className={styles.headerRight}>
            <NotificationDropdown />
            <AvatarMenu user={user} />
          </div>
        </header>

        <div key={pathname} className={styles.content}>
          {pushState === 'prompt' && !pushDismissed && (
            <PushPrompt
              onEnable={async () => {
                const ok = await subscribe();
                if (ok) {
                  localStorage.setItem('sotto:push-prompt-dismissed', 'true');
                  setPushDismissed(true);
                }
              }}
              onDismiss={() => {
                localStorage.setItem('sotto:push-prompt-dismissed', 'true');
                setPushDismissed(true);
              }}
            />
          )}
          {children}
        </div>
      </div>

      <MobileNav currentPath={pathname} hasActivePlayer={hasActivePlayer} />
    </div>
  );
}
