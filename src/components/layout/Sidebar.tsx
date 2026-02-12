'use client';

import Link from 'next/link';
import Image from 'next/image';
import {
  LayoutDashboard,
  PlusCircle,
  Radio,
  Settings,
  CreditCard,
  BarChart2,
  Mic,
  Users,
  LogOut,
  Shield,
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
    role?: string;
  };
}

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

function getNavItems(role: string): NavItem[] {
  const items: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/feed', label: 'Discover', icon: Radio },
    { href: '/create', label: 'Create', icon: PlusCircle },
  ];

  // Analytics - CREATOR and ADMIN
  if (role === 'CREATOR' || role === 'ADMIN') {
    items.push({ href: '/analytics', label: 'Analytics', icon: BarChart2 });
  }

  // Voices - CREATOR and ADMIN
  if (role === 'CREATOR' || role === 'ADMIN') {
    items.push({ href: '/settings/voices', label: 'Voices', icon: Mic });
  }

  // Team - CREATOR and ADMIN
  if (role === 'CREATOR' || role === 'ADMIN') {
    items.push({ href: '/team', label: 'Team', icon: Users });
  }

  // Billing - everyone except ADMIN (admin doesn't need it)
  if (role !== 'ADMIN') {
    items.push({ href: '/billing', label: 'Billing', icon: CreditCard });
  }

  items.push({ href: '/settings', label: 'Settings', icon: Settings });

  return items;
}

export function Sidebar({ currentPath, isOpen = false, onClose, user }: SidebarProps) {
  const displayName = user?.name || user?.email || 'User';
  const initials = displayName.charAt(0).toUpperCase();
  const role = user?.role || 'USER';
  const navItems = getNavItems(role);

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

        {role === 'ADMIN' && (
          <div className={styles.adminLink}>
            <Link href="/admin" className={styles.adminLinkAnchor} onClick={onClose}>
              <Shield size={16} aria-hidden="true" />
              Admin Panel
            </Link>
          </div>
        )}

        <div className={styles.userSection}>
          <div className={styles.avatar}>
            {user?.image ? (
              <Image src={user.image} alt={`${displayName}'s avatar`} width={32} height={32} />
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
