'use client';

import styles from './DurationSelector.module.css';

const DURATION_OPTIONS = [5, 10, 15, 20, 25, 30, 35, 40] as const;
const ADMIN_SHORT_OPTIONS = [1, 2, 3] as const;

interface DurationSelectorProps {
  value: number;
  onChange: (minutes: number) => void;
  max?: number;
  isAdmin?: boolean;
}

export function DurationSelector({ value, onChange, max = 40, isAdmin }: DurationSelectorProps) {
  const standardOptions = DURATION_OPTIONS.filter((m) => m <= max);
  const options = isAdmin ? [...ADMIN_SHORT_OPTIONS, ...standardOptions] : standardOptions;

  return (
    <div className={styles.root}>
      <label className={styles.label}>Duration</label>
      <div className={styles.options}>
        {options.map((minutes) => (
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
