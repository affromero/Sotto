import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import type { ColorScheme } from '@sotto/shared';
import { useThemeColors } from './useThemeColors';
type NamedStyles<T> = StyleSheet.NamedStyles<T>;

/**
 * Creates a hook that returns a memoized StyleSheet keyed by the active color scheme.
 *
 * Usage:
 *   const useStyles = createThemedStyles((c) => ({
 *     root: { backgroundColor: c.background },
 *   }));
 *
 *   function MyComponent() {
 *     const styles = useStyles();
 *     return <View style={styles.root} />;
 *   }
 */
export function createThemedStyles<T extends NamedStyles<T>>(
  factory: (c: ColorScheme) => T,
) {
  const cache = new Map<string, T>();

  return function useStyles(): T {
    const c = useThemeColors();
    const key = c.background; // unique per color set

    return useMemo(() => {
      const cached = cache.get(key);
      if (cached) return cached;
      const created = StyleSheet.create(factory(c));
      cache.set(key, created);
      return created;
    }, [c, key]);
  };
}
