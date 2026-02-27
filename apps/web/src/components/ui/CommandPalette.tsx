'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import {
  LayoutDashboard,
  Radio,
  PlusCircle,
  BarChart2,
  Settings,
  Key,
  Bookmark,
  Search,
  Sun,
  Moon,
  LogOut,
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useTheme } from '@/components/providers/ThemeProvider';
import styles from './CommandPalette.module.css';

interface PodcastResult {
  id: string;
  title: string;
  topic: string | null;
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/feed', label: 'Discover', icon: Radio },
  { href: '/create', label: 'Create Podcast', icon: PlusCircle },
  { href: '/analytics', label: 'Analytics', icon: BarChart2 },
  { href: '/ideas', label: 'Library', icon: Bookmark },
  { href: '/billing', label: 'API Keys', icon: Key },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PodcastResult[]>([]);
  const router = useRouter();
  const { data: session } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const userRole = (session?.user as { role?: string } | undefined)?.role;

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Live podcast search
  useEffect(() => {
    clearTimeout(debounceRef.current);

    if (search.length < 2) {
      debounceRef.current = setTimeout(() => setResults([]), 0);
      return () => clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/feed?search=${encodeURIComponent(search)}&mode=explore`);
        if (res.ok) {
          const data = await res.json();
          setResults((data.podcasts ?? []).slice(0, 5));
        }
      } catch {
        // Silently fail search
      }
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      setSearch('');
      router.push(href);
    },
    [router]
  );

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
    setOpen(false);
  }, [resolvedTheme, setTheme]);

  const signOut = useCallback(() => {
    setOpen(false);
    router.push('/auth/signout');
  }, [router]);

  const isAdmin = userRole === 'ADMIN';

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      className={styles.dialog}
      overlayClassName={styles.overlay}
    >
      <Command.Input
        value={search}
        onValueChange={setSearch}
        placeholder="Search podcasts, navigate, or take action..."
        className={styles.input}
      />
      <Command.List className={styles.list}>
        <Command.Empty className={styles.empty}>No results found.</Command.Empty>

        {/* Search results */}
        {results.length > 0 && (
          <Command.Group heading="Podcasts" className={styles.group}>
            {results.map((podcast) => (
              <Command.Item
                key={podcast.id}
                value={`podcast ${podcast.title} ${podcast.topic ?? ''}`}
                onSelect={() => navigate(`/podcast/${podcast.id}`)}
                className={styles.item}
              >
                <Search size={16} aria-hidden="true" />
                <span className={styles.itemLabel}>{podcast.title}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

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
            value="Create Podcast"
            onSelect={() => navigate('/create')}
            className={styles.item}
          >
            <PlusCircle size={16} aria-hidden="true" />
            <span className={styles.itemLabel}>Create Podcast</span>
          </Command.Item>
          <Command.Item
            value={`Toggle theme ${resolvedTheme === 'dark' ? 'light' : 'dark'}`}
            onSelect={toggleTheme}
            className={styles.item}
          >
            {resolvedTheme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            <span className={styles.itemLabel}>
              Switch to {resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode
            </span>
          </Command.Item>
          <Command.Item
            value="Sign Out"
            onSelect={signOut}
            className={styles.item}
          >
            <LogOut size={16} aria-hidden="true" />
            <span className={styles.itemLabel}>Sign Out</span>
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
