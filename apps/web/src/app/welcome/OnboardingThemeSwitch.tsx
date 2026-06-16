'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/components/providers/ThemeProvider';
import styles from './OnboardingThemeSwitch.module.css';

interface OnboardingThemeSwitchProps {
  className?: string;
}

export function OnboardingThemeSwitch({ className }: OnboardingThemeSwitchProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const Icon = isDark ? Sun : Moon;
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      className={[styles.root, className].filter(Boolean).join(' ')}
      onClick={(event) => {
        event.stopPropagation();
        setTheme(isDark ? 'light' : 'dark');
      }}
      aria-label={label}
      title={label}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}
