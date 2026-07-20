// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { themePrefsFromUser, serializeThemePrefs, DEFAULT_THEME_PREFS } from '@/lib/theme-prefs';

describe('themePrefsFromUser', () => {
  it('maps stored columns onto runtime prefs', () => {
    expect(
      themePrefsFromUser({
        themeMode: 'dark',
        themePalette: 'paper',
        themeAccent: '#1C7A6B',
        reducedMotion: true,
      })
    ).toEqual({ mode: 'dark', palette: 'paper', accent: '#1C7A6B', reducedMotion: true });
  });

  it('falls back to safe defaults for unknown/null values', () => {
    expect(
      themePrefsFromUser({
        themeMode: 'rainbow',
        themePalette: 'neon',
        themeAccent: null,
        reducedMotion: null,
      })
    ).toEqual({ mode: 'system', palette: 'aula', accent: null, reducedMotion: false });
  });

  it('matches the default prefs for an empty profile', () => {
    expect(themePrefsFromUser({})).toEqual(DEFAULT_THEME_PREFS);
  });
});

describe('serializeThemePrefs', () => {
  it('round-trips through JSON', () => {
    const prefs = {
      mode: 'light' as const,
      palette: 'aula' as const,
      accent: '#3F4FB0',
      reducedMotion: false,
    };
    expect(JSON.parse(serializeThemePrefs(prefs))).toEqual(prefs);
  });
});
