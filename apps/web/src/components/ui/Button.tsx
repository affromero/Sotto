import { SottoSpinner } from './SottoSpinner';
import styles from './Button.module.css';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'small' | 'medium' | 'large';
  fullWidth?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'medium',
  fullWidth = false,
  loading = false,
  disabled,
  children,
  className,
  ...props
}: ButtonProps) {
  const spinnerColor = variant === 'primary' || variant === 'danger' ? 'white' : 'primary';

  return (
    <button
      className={`${styles.button} ${styles[variant]} ${styles[size]} ${fullWidth ? styles.fullWidth : ''} ${className || ''}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <SottoSpinner size="small" color={spinnerColor} ariaLabel="Loading" />}
      {children}
    </button>
  );
}
