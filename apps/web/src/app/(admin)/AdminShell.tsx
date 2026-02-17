'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  Radio,
  Mail,
  BarChart2,
  Shield,
  AtSign,
  Settings,
  MessageSquareShare,
  Star,
  Sparkles,
  ArrowLeft,
  Menu,
} from 'lucide-react';
import styles from './AdminShell.module.css';

interface AdminShellProps {
  user: {
    name: string | null;
    email: string | null;
    image: string | null;
  };
  children: React.ReactNode;
}

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const navItems: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/podcasts', label: 'Podcasts', icon: Radio },
  { href: '/admin/waitlist', label: 'Waitlist', icon: Mail },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart2 },
  { href: '/admin/handles', label: 'Handles', icon: AtSign },
  { href: '/admin/moderation', label: 'Moderation', icon: Shield },
  { href: '/admin/config', label: 'Config', icon: Settings },
  { href: '/admin/twitter', label: 'Twitter', icon: MessageSquareShare },
  { href: '/admin/ratings', label: 'TTS Ratings', icon: Star },
  { href: '/admin/inspire', label: 'Inspire', icon: Sparkles },
];

export function AdminShell({ user, children }: AdminShellProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const displayName = user.name || user.email || 'Admin';
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className={styles.layout}>
      {sidebarOpen && (
        <div className={styles.overlay} onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      <aside
        className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}
        aria-label="Admin navigation"
      >
        <div className={styles.brand}>
          <Link href="/dashboard" className={styles.logo}>
            Sotto
          </Link>
          <span className={styles.subtitle}>Admin</span>
        </div>

        <nav className={styles.nav} aria-label="Admin sections">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon className={styles.navIcon} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.backLink}>
          <Link
            href="/dashboard"
            className={styles.backLinkAnchor}
            onClick={() => setSidebarOpen(false)}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to Dashboard
          </Link>
        </div>

        <div className={styles.userSection}>
          <div className={styles.avatar}>
            {user.image ? (
              <Image src={user.image} alt={`${displayName}'s avatar`} width={32} height={32} />
            ) : (
              initials
            )}
          </div>
          <div className={styles.userInfo}>
            <span className={styles.userName}>{displayName}</span>
            <span className={styles.userRole}>Administrator</span>
          </div>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topBar}>
          <button
            className={styles.menuButton}
            onClick={() => setSidebarOpen(true)}
            aria-label="Open admin navigation"
            type="button"
          >
            <Menu size={24} aria-hidden="true" />
          </button>
          <span className={styles.logo}>Sotto</span>
          <span className={styles.subtitle}>Admin</span>
        </header>

        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
