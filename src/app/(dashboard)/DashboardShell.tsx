'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileNav } from '@/components/layout/MobileNav';
import { Menu } from 'lucide-react';
import styles from './DashboardShell.module.css';

interface DashboardShellProps {
  user: {
    name: string | null;
    email: string | null;
    image: string | null;
  };
  children: React.ReactNode;
}

export function DashboardShell({ user, children }: DashboardShellProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className={styles.layout}>
      <Sidebar
        currentPath={pathname}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
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
        </header>

        <div className={styles.content}>
          {children}
        </div>
      </div>

      <MobileNav currentPath={pathname} />
    </div>
  );
}
