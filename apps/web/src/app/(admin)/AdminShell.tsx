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
  Megaphone,
  FlaskConical,
  HeartPulse,
  ListTodo,
  Globe,
  ArrowLeft,
  Menu,
  ChevronDown,
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

interface NavGroup {
  label: string | null;
  items: NavItem[];
  defaultOpen?: boolean;
}

const navGroups: NavGroup[] = [
  {
    label: null,
    items: [{ href: '/admin', label: 'Overview', icon: LayoutDashboard }],
  },
  {
    label: 'Content',
    defaultOpen: true,
    items: [
      { href: '/admin/users', label: 'Users', icon: Users },
      { href: '/admin/podcasts', label: 'Podcasts', icon: Radio },
      { href: '/admin/moderation', label: 'Moderation', icon: Shield },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: '/admin/revenue', label: 'Revenue', icon: Wallet },
      { href: '/admin/costs', label: 'Costs', icon: DollarSign },
    ],
  },
  {
    label: 'Metrics',
    items: [
      { href: '/admin/engagement', label: 'Engagement', icon: Heart },
      { href: '/admin/playback', label: 'Playback', icon: Headphones },
      { href: '/admin/pipeline', label: 'Pipeline', icon: Activity },
      { href: '/admin/retention', label: 'Retention', icon: TrendingUp },
      { href: '/admin/analytics', label: 'Analytics', icon: BarChart2 },
      { href: '/admin/analytics/live', label: 'Live Map', icon: Globe },
    ],
  },
  {
    label: 'Tools',
    items: [
      { href: '/admin/waitlist', label: 'Waitlist', icon: Mail },
      { href: '/admin/handles', label: 'Handles', icon: AtSign },
      { href: '/admin/config', label: 'Config', icon: Settings },
      { href: '/admin/announcements', label: 'Announcements', icon: Megaphone },
      { href: '/admin/models', label: 'Model Tester', icon: FlaskConical },
      { href: '/admin/health', label: 'System Health', icon: HeartPulse },
      { href: '/admin/queues', label: 'Queues', icon: ListTodo },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { href: '/admin/twitter', label: 'Twitter', icon: MessageSquareShare },
    ],
  },
  {
    label: 'AI / ML',
    items: [
      { href: '/admin/ratings', label: 'TTS Ratings', icon: Star },
      { href: '/admin/inspire', label: 'Inspire', icon: Sparkles },
      { href: '/admin/intelligence', label: 'Intelligence', icon: Brain },
      { href: '/admin/recommendations', label: 'Recommendations', icon: Target },
    ],
  },
];

function getInitialExpanded(pathname: string): Record<string, boolean> {
  const expanded: Record<string, boolean> = {};
  for (const group of navGroups) {
    if (!group.label) continue;
    const containsActive = group.items.some(({ href }) => pathname === href);
    expanded[group.label] = containsActive || !!group.defaultOpen;
  }
  return expanded;
}

export function AdminShell({ pendingReportCount, children }: AdminShellProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => getInitialExpanded(pathname));

  function toggleGroup(label: string) {
    setExpanded((prev) => ({ ...prev, [label]: !prev[label] }));
  }

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
          {navGroups.map((group, gi) => {
            if (!group.label) {
              return group.items.map(({ href, label, icon: Icon }) => {
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
              });
            }

            const isOpen = expanded[group.label] ?? false;

            return (
              <div key={group.label} className={gi > 0 ? styles.navGroup : undefined}>
                <button
                  type="button"
                  className={styles.navGroupLabel}
                  onClick={() => toggleGroup(group.label!)}
                  aria-expanded={isOpen}
                >
                  {group.label}
                  <ChevronDown
                    className={`${styles.navGroupChevron} ${isOpen ? styles.navGroupChevronOpen : ''}`}
                    aria-hidden="true"
                  />
                </button>
                {isOpen && (
                  <div className={styles.navGroupItems}>
                    {group.items.map(({ href, label, icon: Icon }) => {
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
                  </div>
                )}
              </div>
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
