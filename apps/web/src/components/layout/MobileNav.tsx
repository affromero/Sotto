'use client';

import Link from 'next/link';
import { GraduationCap, Network, Settings } from 'lucide-react';
import styles from './MobileNav.module.css';

interface MobileNavProps {
  currentPath: string;
  hasActivePlayer?: boolean;
}

const tabs = [
  { href: '/learn', label: 'Learn', icon: GraduationCap },
  { href: '/memory', label: 'Memory', icon: Network },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function MobileNav({ currentPath, hasActivePlayer = false }: MobileNavProps) {
  return (
    <nav
      className={`${styles.mobileNav} ${hasActivePlayer ? styles.mobileNavWithPlayer : ''}`}
      aria-label="Mobile navigation"
    >
      {tabs.map(({ href, label, icon: Icon }) => {
        const isActive = currentPath === href || currentPath.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            aria-current={isActive ? 'page' : undefined}
            aria-label={label}
          >
            <Icon className={styles.tabIcon} aria-hidden="true" />
            <span className={styles.tabLabel}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
