'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';
type Palette = 'aula' | 'paper';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  accent: string;
  setAccent: (accent: string) => void;
  palette: Palette;
  setPalette: (palette: Palette) => void;
  reducedMotion: boolean;
  setReducedMotion: (reduced: boolean) => void;
}

import { createContext, useContext, useEffect } from 'react';

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
  accent: '#3F4FB0',
  setAccent: () => {},
  palette: 'aula',
  setPalette: () => {},
  reducedMotion: false,
  setReducedMotion: () => {},
});

const STORAGE_KEY = 'sotto-theme';
const ACCENT_STORAGE_KEY = 'sotto-accent';
const PALETTE_STORAGE_KEY = 'sotto-palette';
const MOTION_STORAGE_KEY = 'sotto-motion';

const DEFAULT_ACCENT = '#3F4FB0';
const DEFAULT_PALETTE: Palette = 'aula';

function isLightOnlyRoute(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname.startsWith('/auth/') ||
    (pathname.startsWith('/episode/') && pathname.endsWith('/embed'))
  );
}

// ── Persist the active profile's appearance to the DB (keeps it across switches) ──
// Reads the current values straight from localStorage so every setter persists the
// full set without threading state. Debounced so dragging the accent doesn't spam.

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const accent = localStorage.getItem(ACCENT_STORAGE_KEY);
    fetch('/api/v1/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        themeMode: getThemeSnapshot(),
        themePalette: getPaletteSnapshot(),
        themeAccent: accent ?? null,
        reducedMotion: getMotionSnapshot(),
      }),
    }).catch(() => {});
  }, 400);
}

// ── Theme external store ──────────────────────────────────────────────────────

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
  schedulePersist();
}

// ── System (prefers-color-scheme) store ──────────────────────────────────────

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

// ── Accent external store ─────────────────────────────────────────────────────

let accentListeners: Array<() => void> = [];

function subscribeAccent(listener: () => void) {
  accentListeners = [...accentListeners, listener];
  return () => {
    accentListeners = accentListeners.filter((l) => l !== listener);
  };
}

function getAccentSnapshot(): string {
  return localStorage.getItem(ACCENT_STORAGE_KEY) ?? DEFAULT_ACCENT;
}

function getAccentServerSnapshot(): string {
  return DEFAULT_ACCENT;
}

function setStoredAccent(accent: string) {
  localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  accentListeners.forEach((l) => l());
  schedulePersist();
}

// ── Palette external store ────────────────────────────────────────────────────

let paletteListeners: Array<() => void> = [];

function subscribePalette(listener: () => void) {
  paletteListeners = [...paletteListeners, listener];
  return () => {
    paletteListeners = paletteListeners.filter((l) => l !== listener);
  };
}

function getPaletteSnapshot(): Palette {
  const stored = localStorage.getItem(PALETTE_STORAGE_KEY) as Palette | null;
  return stored && ['aula', 'paper'].includes(stored) ? stored : DEFAULT_PALETTE;
}

function getPaletteServerSnapshot(): Palette {
  return DEFAULT_PALETTE;
}

function setStoredPalette(palette: Palette) {
  localStorage.setItem(PALETTE_STORAGE_KEY, palette);
  paletteListeners.forEach((l) => l());
  schedulePersist();
}

// ── Reduced-motion external store ─────────────────────────────────────────────

let motionListeners: Array<() => void> = [];

function subscribeMotion(listener: () => void) {
  motionListeners = [...motionListeners, listener];
  return () => {
    motionListeners = motionListeners.filter((l) => l !== listener);
  };
}

function getMotionSnapshot(): boolean {
  return localStorage.getItem(MOTION_STORAGE_KEY) === 'reduce';
}

function getMotionServerSnapshot(): boolean {
  return false;
}

function setStoredMotion(reduced: boolean) {
  localStorage.setItem(MOTION_STORAGE_KEY, reduced ? 'reduce' : 'auto');
  motionListeners.forEach((l) => l());
  schedulePersist();
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot);
  const systemTheme = useSyncExternalStore(
    subscribeSystemTheme,
    getSystemThemeSnapshot,
    getSystemThemeServerSnapshot
  );
  const accent = useSyncExternalStore(subscribeAccent, getAccentSnapshot, getAccentServerSnapshot);
  const palette = useSyncExternalStore(
    subscribePalette,
    getPaletteSnapshot,
    getPaletteServerSnapshot
  );
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    getMotionSnapshot,
    getMotionServerSnapshot
  );

  const resolvedTheme = useMemo<ResolvedTheme>(() => {
    if (isLightOnlyRoute(pathname)) return 'light';
    return theme === 'system' ? systemTheme : theme;
  }, [theme, systemTheme, pathname]);

  // Sync theme to DOM
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  // Sync accent to DOM
  useEffect(() => {
    document.documentElement.style.setProperty('--user-accent', accent);
  }, [accent]);

  // Sync palette to DOM
  useEffect(() => {
    document.documentElement.dataset.palette = palette;
  }, [palette]);

  // Sync reduced-motion to DOM
  useEffect(() => {
    if (reducedMotion) {
      document.documentElement.dataset.reducedMotion = 'reduce';
    } else {
      delete document.documentElement.dataset.reducedMotion;
    }
  }, [reducedMotion]);

  const setTheme = useCallback((newTheme: Theme) => {
    setStoredTheme(newTheme);
  }, []);

  const setAccent = useCallback((newAccent: string) => {
    setStoredAccent(newAccent);
  }, []);

  const setPalette = useCallback((newPalette: Palette) => {
    setStoredPalette(newPalette);
  }, []);

  const setReducedMotion = useCallback((reduced: boolean) => {
    setStoredMotion(reduced);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        setTheme,
        accent,
        setAccent,
        palette,
        setPalette,
        reducedMotion,
        setReducedMotion,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
