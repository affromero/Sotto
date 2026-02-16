'use client';

import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/components/providers/ThemeProvider';
import styles from './ThemeSelector.module.css';

const options = [
  { value: 'light' as const, label: 'Light', icon: Sun },
  { value: 'dark' as const, label: 'Dark', icon: Moon },
  { value: 'system' as const, label: 'System', icon: Monitor },
];

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  return (
    <div className={styles.options}>
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          className={`${styles.option} ${theme === value ? styles.optionActive : ''}`}
          onClick={() => setTheme(value)}
          aria-pressed={theme === value}
        >
          <Icon size={20} className={styles.icon} />
          <span className={styles.label}>{label}</span>
        </button>
      ))}
    </div>
  );
}
