'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileNav } from '@/components/layout/MobileNav';
import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import { NotificationDropdown } from '@/components/notifications/NotificationDropdown';
import { PushPrompt } from '@/components/notifications/PushPrompt';
import { usePushSubscription } from '@/lib/hooks/usePushSubscription';
import { Menu } from 'lucide-react';
import styles from './DashboardShell.module.css';

interface DashboardShellProps {
  user: {
    name: string | null;
    email: string | null;
    image: string | null;
    role?: string;
  };
  hasPodcasts?: boolean;
  children: React.ReactNode;
}

export function DashboardShell({ user, hasPodcasts = false, children }: DashboardShellProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pushDismissed, setPushDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('sotto:push-prompt-dismissed') === 'true';
  });
  const player = usePlayer();
  const hasActivePlayer = !!player.podcastId;
  const { pushState, subscribe } = usePushSubscription();

  return (
    <div className={styles.layout}>
      <Sidebar
        currentPath={pathname}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        hasPodcasts={hasPodcasts}
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
          <div className={styles.bellWrapper}>
            <NotificationDropdown />
          </div>
        </header>

        <div key={pathname} className={styles.content}>
          {pushState === 'prompt' && !pushDismissed && (
            <PushPrompt
              onEnable={subscribe}
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
