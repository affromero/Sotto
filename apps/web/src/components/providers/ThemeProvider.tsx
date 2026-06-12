'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

import { createContext, useContext, useEffect } from 'react';

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
    (pathname.startsWith('/episode/') && pathname.endsWith('/embed'))
  );
}

// External store for theme preference (localStorage)
let themeListeners: Array<() => void> = [];

function subscribeTheme(listener: () => void) {
  themeListeners = [...themeListeners, listener];
  return () => {
    themeListeners = themeListeners.filter((l) => l !== listener);
  };
}

function getThemeSnapshot(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  return stored && ['light', 'dark', 'system'].includes(stored) ? stored : 'system';
}

function getThemeServerSnapshot(): Theme {
  return 'system';
}

function setStoredTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  themeListeners.forEach((l) => l());
}

// External store for system theme (matchMedia)
function subscribeSystemTheme(callback: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

function getSystemThemeSnapshot(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getSystemThemeServerSnapshot(): ResolvedTheme {
  return 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot);
  const systemTheme = useSyncExternalStore(subscribeSystemTheme, getSystemThemeSnapshot, getSystemThemeServerSnapshot);

  const resolvedTheme = useMemo<ResolvedTheme>(() => {
    if (isLightOnlyRoute(pathname)) return 'light';
    return theme === 'system' ? systemTheme : theme;
  }, [theme, systemTheme, pathname]);

  // Sync to DOM
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setStoredTheme(newTheme);
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
