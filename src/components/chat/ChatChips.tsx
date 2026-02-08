import styles from './ChatChips.module.css';

interface ChatChipsProps {
  chips: string[];
  onSelect: (chip: string) => void;
  disabled?: boolean;
}

export function ChatChips({ chips, onSelect, disabled = false }: ChatChipsProps) {
  return (
    <div className={styles.root} role="group" aria-label="Suggestion options">
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          className={`${styles.chip} ${disabled ? styles.disabled : ''}`}
          onClick={() => !disabled && onSelect(chip)}
          disabled={disabled}
          aria-label={`Select: ${chip}`}
        >
          {chip}
        </button>
      ))}
    </div>
  );
}
