'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import {
  GraduationCap,
  Brain,
  Settings,
  Key,
  Sun,
  Moon,
  LogOut,
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useTheme } from '@/components/providers/ThemeProvider';
import styles from './CommandPalette.module.css';

const NAV_ITEMS = [
  { href: '/learn', label: 'Learn', icon: GraduationCap },
  { href: '/memory', label: 'Memory', icon: Brain },
  { href: '/settings/api', label: 'API Keys', icon: Key },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [search, setSearch] = useState('');
  const router = useRouter();
  const { data: session } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const userRole = (session?.user as { role?: string } | undefined)?.role;

  // Animated close: set closing state, wait for animation, then unmount
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && open) {
        setClosing(true);
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        setTimeout(
          () => {
            setOpen(false);
            setClosing(false);
            setSearch('');
          },
          prefersReduced ? 0 : 200
        );
      } else {
        setOpen(nextOpen);
      }
    },
    [open]
  );

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (open) {
          handleOpenChange(false);
        } else {
          setOpen(true);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, handleOpenChange]);

  const navigate = useCallback(
    (href: string) => {
      handleOpenChange(false);
      router.push(href);
    },
    [router, handleOpenChange]
  );

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
    handleOpenChange(false);
  }, [resolvedTheme, setTheme, handleOpenChange]);

  const signOut = useCallback(() => {
    handleOpenChange(false);
    router.push('/auth/signout');
  }, [router, handleOpenChange]);

  const isAdmin = userRole === 'ADMIN';

  return (
    <Command.Dialog
      open={open}
      onOpenChange={handleOpenChange}
      label="Command palette"
      className={`${styles.dialog} ${closing ? styles.dialogClosing : ''}`}
      overlayClassName={`${styles.overlay} ${closing ? styles.overlayClosing : ''}`}
    >
      <Command.Input
        value={search}
        onValueChange={setSearch}
        placeholder="Navigate or take action..."
        className={styles.input}
      />
      <Command.List className={styles.list}>
        <Command.Empty className={styles.empty}>No results found.</Command.Empty>

        {/* Navigation */}
        <Command.Group heading="Navigation" className={styles.group}>
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Command.Item
              key={href}
              value={label}
              onSelect={() => navigate(href)}
              className={styles.item}
            >
              <Icon size={16} aria-hidden="true" />
              <span className={styles.itemLabel}>{label}</span>
            </Command.Item>
          ))}
          {isAdmin && (
            <Command.Item
              value="Admin Panel"
              onSelect={() => navigate('/admin')}
              className={styles.item}
            >
              <Settings size={16} aria-hidden="true" />
              <span className={styles.itemLabel}>Admin Panel</span>
            </Command.Item>
          )}
        </Command.Group>

        {/* Actions */}
        <Command.Group heading="Actions" className={styles.group}>
          <Command.Item
            value={`Toggle theme ${resolvedTheme === 'dark' ? 'light' : 'dark'}`}
            onSelect={toggleTheme}
            className={styles.item}
          >
            {resolvedTheme === 'dark' ? (
              <Sun size={16} aria-hidden="true" />
            ) : (
              <Moon size={16} aria-hidden="true" />
            )}
            <span className={styles.itemLabel}>
              Switch to {resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode
            </span>
          </Command.Item>
          <Command.Item value="Sign Out" onSelect={signOut} className={styles.item}>
            <LogOut size={16} aria-hidden="true" />
            <span className={styles.itemLabel}>Sign Out</span>
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
