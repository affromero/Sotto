'use client';

import styles from './SuggestionChips.module.css';

interface SuggestionChipsProps {
  chips: string[];
  onSelect: (chip: string) => void;
  disabled?: boolean;
}

export function SuggestionChips({ chips, onSelect, disabled = false }: SuggestionChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className={styles.root} role="group" aria-label="Suggestion options">
      <div className={styles.scrollContainer}>
        {chips.map((chip, index) => (
          <button
            key={chip}
            type="button"
            className={styles.chip}
            style={{ animationDelay: `${index * 60}ms` }}
            onClick={() => onSelect(chip)}
            disabled={disabled}
            aria-label={`Select suggestion: ${chip}`}
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}
