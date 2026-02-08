import styles from './Spinner.module.css';

interface SpinnerProps {
  size?: 'small' | 'medium' | 'large';
  color?: 'primary' | 'accent' | 'white';
}

export function Spinner({ size = 'medium', color = 'primary' }: SpinnerProps) {
  return (
    <span
      className={`${styles.spinner} ${styles[size]} ${styles[color]}`}
      role="status"
      aria-label="Loading"
    />
  );
}
