'use client';

import Link from 'next/link';
import {
  LayoutDashboard,
  PlusCircle,
  Radio,
  Settings,
  CreditCard,
  BarChart2,
  Users,
  LogOut,
} from 'lucide-react';
import styles from './Sidebar.module.css';

interface SidebarProps {
  currentPath: string;
  isOpen?: boolean;
  onClose?: () => void;
  user?: {
    name?: string | null;
    image?: string | null;
    email?: string | null;
  };
}

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/create', label: 'Create', icon: PlusCircle },
  { href: '/feed', label: 'Feed', icon: Radio },
  { href: '/billing', label: 'Billing', icon: CreditCard },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/analytics', label: 'Analytics', icon: BarChart2 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ currentPath, isOpen = false, onClose, user }: SidebarProps) {
  const displayName = user?.name || user?.email || 'User';
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className={isOpen ? styles.sidebarOpen : undefined}>
      {isOpen && (
        <div
          className={styles.overlay}
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside className={styles.sidebar} aria-label="Main navigation">
        <div className={styles.brand}>
          <Link href="/" className={styles.logo}>
            Sotto
          </Link>
        </div>

        <nav className={styles.nav} aria-label="Dashboard navigation">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive =
              currentPath === href || currentPath.startsWith(`${href}/`);
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

        <div className={styles.userSection}>
          <div className={styles.avatar}>
            {user?.image ? (
              <img src={user.image} alt={`${displayName}'s avatar`} />
            ) : (
              initials
            )}
          </div>
          <div className={styles.userInfo}>
            <span className={styles.userName}>{displayName}</span>
            <button
              className={styles.signOut}
              onClick={() => {
                /* signOut handled by parent */
              }}
              aria-label="Sign out"
            >
              <LogOut size={12} aria-hidden="true" /> Sign out
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
