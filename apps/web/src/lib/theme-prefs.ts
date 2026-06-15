/**
 * Per-profile appearance preferences. The active profile's prefs ride in a
 * readable `sotto_theme` cookie so the pre-paint init script can apply them
 * flash-free without making the root layout dynamic. The switch route and the
 * appearance PATCH keep the cookie in sync with the DB; localStorage mirrors it
 * for the in-session React store.
 */
export const THEME_PREFS_COOKIE = 'sotto_theme';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemePalette = 'aula' | 'paper';

export interface ThemePrefs {
  mode: ThemeMode;
  palette: ThemePalette;
  /** Hex accent, or null for the brand default. */
  accent: string | null;
  reducedMotion: boolean;
}

export const DEFAULT_THEME_PREFS: ThemePrefs = {
  mode: 'system',
  palette: 'aula',
  accent: null,
  reducedMotion: false,
};

/** Map a profile's stored appearance columns onto the cookie/runtime shape. */
export function themePrefsFromUser(user: {
  themeMode?: string | null;
  themePalette?: string | null;
  themeAccent?: string | null;
  reducedMotion?: boolean | null;
}): ThemePrefs {
  return {
    mode: user.themeMode === 'light' || user.themeMode === 'dark' ? user.themeMode : 'system',
    palette: user.themePalette === 'paper' ? 'paper' : 'aula',
    accent: user.themeAccent ?? null,
    reducedMotion: user.reducedMotion ?? false,
  };
}

export function serializeThemePrefs(prefs: ThemePrefs): string {
  return JSON.stringify(prefs);
}
