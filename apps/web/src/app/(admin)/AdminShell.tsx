'use client';

import Link from 'next/link';
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
  DollarSign,
  Wallet,
  Heart,
  Headphones,
  Activity,
  TrendingUp,
  Brain,
  Target,
  ArrowLeft,
  Menu,
} from 'lucide-react';
import { AccountSwitcher } from '@/components/layout/AccountSwitcher';
import styles from './AdminShell.module.css';

interface AdminShellProps {
  pendingReportCount?: number;
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
  { href: '/admin/revenue', label: 'Revenue', icon: Wallet },
  { href: '/admin/costs', label: 'Costs', icon: DollarSign },
  { href: '/admin/engagement', label: 'Engagement', icon: Heart },
  { href: '/admin/playback', label: 'Playback', icon: Headphones },
  { href: '/admin/pipeline', label: 'Pipeline', icon: Activity },
  { href: '/admin/retention', label: 'Retention', icon: TrendingUp },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart2 },
  { href: '/admin/waitlist', label: 'Waitlist', icon: Mail },
  { href: '/admin/handles', label: 'Handles', icon: AtSign },
  { href: '/admin/moderation', label: 'Moderation', icon: Shield },
  { href: '/admin/config', label: 'Config', icon: Settings },
  { href: '/admin/twitter', label: 'Twitter', icon: MessageSquareShare },
  { href: '/admin/ratings', label: 'TTS Ratings', icon: Star },
  { href: '/admin/inspire', label: 'Inspire', icon: Sparkles },
  { href: '/admin/intelligence', label: 'Intelligence', icon: Brain },
  { href: '/admin/recommendations', label: 'Recommendations', icon: Target },
];

export function AdminShell({ pendingReportCount, children }: AdminShellProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
            const showBadge =
              href === '/admin/moderation' &&
              pendingReportCount !== undefined &&
              pendingReportCount > 0;
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
                {showBadge && (
                  <span className={styles.navBadge} aria-label={`${pendingReportCount} pending reports`}>
                    {pendingReportCount}
                  </span>
                )}
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

        <AccountSwitcher variant="admin" />
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
