import styles from './Chip.module.css';

interface ChipProps {
  label: string;
  selected?: boolean;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'accent';
}

export function Chip({ label, selected = false, onClick, variant = 'default' }: ChipProps) {
  return (
    <button
      className={`${styles.chip} ${styles[variant]} ${selected ? styles.selected : ''}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
