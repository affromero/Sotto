import { useEffect } from 'react';
import { Appearance, ColorSchemeName } from 'react-native';
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { colors, darkColors } from '@sotto/shared';
import type { ColorScheme } from '@sotto/shared';

type Scheme = 'light' | 'dark' | 'system';

interface ThemeStore {
  scheme: Scheme;
  resolved: 'light' | 'dark';
  setScheme: (scheme: Scheme) => void;
  resolve: (system: ColorSchemeName) => void;
}

const STORAGE_KEY = 'sotto_color_scheme';

function resolveScheme(scheme: Scheme, system: ColorSchemeName): 'light' | 'dark' {
  if (scheme === 'system') return system === 'dark' ? 'dark' : 'light';
  return scheme;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  scheme: 'system',
  resolved: Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
  setScheme: (scheme) => {
    SecureStore.setItemAsync(STORAGE_KEY, scheme).catch(() => {});
    const system = Appearance.getColorScheme();
    set({ scheme, resolved: resolveScheme(scheme, system) });
  },
  resolve: (system) => {
    const { scheme } = get();
    set({ resolved: resolveScheme(scheme, system) });
  },
}));

// Load persisted preference on import
SecureStore.getItemAsync(STORAGE_KEY).then((stored) => {
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    const system = Appearance.getColorScheme();
    useThemeStore.setState({
      scheme: stored,
      resolved: resolveScheme(stored, system),
    });
  }
}).catch(() => {});

/**
 * Hook that listens for system appearance changes and returns the active color set.
 */
export function useThemeColors(): ColorScheme {
  const resolved = useThemeStore((s) => s.resolved);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      useThemeStore.getState().resolve(colorScheme);
    });
    return () => sub.remove();
  }, []);

  return resolved === 'dark' ? darkColors : colors;
}
