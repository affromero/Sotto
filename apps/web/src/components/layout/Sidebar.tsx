'use client';

import Link from 'next/link';
import {
  LayoutDashboard,
  PlusCircle,
  Radio,
  Settings,
  Key,
  BarChart2,
  Mic,
  Bookmark,
  Shield,
  Activity,
} from 'lucide-react';
import { AccountSwitcher } from './AccountSwitcher';
import { NotificationDropdown } from '@/components/notifications/NotificationDropdown';
import styles from './Sidebar.module.css';

interface SidebarProps {
  currentPath: string;
  isOpen?: boolean;
  onClose?: () => void;
  hasPodcasts?: boolean;
  hasActivePlayer?: boolean;
  user?: {
    name?: string | null;
    image?: string | null;
    email?: string | null;
    role?: string;
  };
}

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

function getNavItems(role: string, hasPodcasts: boolean): NavItem[] {
  const items: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/feed', label: 'Discover', icon: Radio },
    { href: '/create', label: 'Create', icon: PlusCircle },
  ];

  // Analytics - users with podcasts or ADMIN
  if (hasPodcasts || role === 'ADMIN') {
    items.push({ href: '/analytics', label: 'Analytics', icon: BarChart2 });
  }

  // Voices - CREATOR and ADMIN
  if (role === 'CREATOR' || role === 'ADMIN') {
    items.push({ href: '/settings/voices', label: 'Voices', icon: Mic });
  }

  items.push({ href: '/ideas', label: 'Library', icon: Bookmark });
  items.push({ href: '/billing', label: 'API Keys', icon: Key });
  items.push({ href: '/settings', label: 'Settings', icon: Settings });

  return items;
}

export function Sidebar({ currentPath, isOpen = false, onClose, hasPodcasts = false, hasActivePlayer = false, user }: SidebarProps) {
  const role = user?.role || 'USER';
  const navItems = getNavItems(role, hasPodcasts);

  return (
    <div className={isOpen ? styles.sidebarOpen : undefined}>
      {isOpen && <div className={styles.overlay} onClick={onClose} aria-hidden="true" />}
      <aside className={styles.sidebar} aria-label="Main navigation">
        <div className={styles.brand}>
          <Link href="/" className={styles.logo}>
            Sotto
          </Link>
        </div>

        <nav className={styles.nav} aria-label="Dashboard navigation">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = currentPath === href || currentPath.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={onClose}
              >
                <Icon className={styles.navIcon} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.notificationSection}>
          <NotificationDropdown />
        </div>

        <div className={styles.statusLink}>
          <a
            href="https://stats.uptimerobot.com/jft3J7XAG9"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.statusLinkAnchor}
          >
            <Activity size={16} aria-hidden="true" />
            System Status
          </a>
        </div>

        {role === 'ADMIN' && (
          <div className={styles.adminLink}>
            <Link href="/admin" className={styles.adminLinkAnchor} onClick={onClose}>
              <Shield size={16} aria-hidden="true" />
              Admin Panel
            </Link>
          </div>
        )}

        <AccountSwitcher variant="dashboard" hasActivePlayer={hasActivePlayer} />
      </aside>
    </div>
  );
}
