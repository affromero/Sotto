'use client';

import styles from './DurationSelector.module.css';

const DURATION_OPTIONS = [5, 10, 15, 20, 25, 30, 35, 40] as const;

interface DurationSelectorProps {
  value: number;
  onChange: (minutes: number) => void;
}

export function DurationSelector({ value, onChange }: DurationSelectorProps) {
  return (
    <div className={styles.root}>
      <label className={styles.label}>Duration</label>
      <div className={styles.options}>
        {DURATION_OPTIONS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            className={`${styles.option} ${value === minutes ? styles.optionActive : ''}`}
            onClick={() => onChange(minutes)}
            aria-pressed={value === minutes}
          >
            {minutes} min
          </button>
        ))}
      </div>
    </div>
  );
}
