'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
});

const STORAGE_KEY = 'sotto-theme';

function isLightOnlyRoute(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname.startsWith('/auth/') ||
    (pathname.startsWith('/podcast/') && pathname.endsWith('/embed'))
  );
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? getSystemTheme() : theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { status } = useSession();
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  // Read stored preference on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored && ['light', 'dark', 'system'].includes(stored)) {
      setThemeState(stored);
    }
  }, []);

  // Compute effective theme based on route, auth status, and preference
  useEffect(() => {
    const forcedLight = isLightOnlyRoute(pathname) || status === 'unauthenticated';
    const effective: ResolvedTheme = forcedLight ? 'light' : resolveTheme(theme);
    setResolvedTheme(effective);
    document.documentElement.dataset.theme = effective;
  }, [theme, pathname, status]);

  // Listen for OS theme changes when preference is 'system'
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (theme !== 'system') return;
      const forcedLight = isLightOnlyRoute(pathname) || status === 'unauthenticated';
      const effective: ResolvedTheme = forcedLight ? 'light' : getSystemTheme();
      setResolvedTheme(effective);
      document.documentElement.dataset.theme = effective;
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, pathname, status]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
