'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileNav } from '@/components/layout/MobileNav';
import { usePlayer } from '@/components/providers/AudioPlayerProvider';
import { NotificationDropdown } from '@/components/notifications/NotificationDropdown';
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
  const player = usePlayer();
  const hasActivePlayer = !!player.podcastId;

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
          {children}
        </div>
      </div>

      <MobileNav currentPath={pathname} hasActivePlayer={hasActivePlayer} />
    </div>
  );
}
