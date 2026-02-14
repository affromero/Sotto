import styles from './Card.module.css';

interface CardProps {
  variant?: 'default' | 'elevated' | 'outlined';
  padding?: 'none' | 'small' | 'medium' | 'large';
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function Card({
  variant = 'default',
  padding = 'medium',
  children,
  className,
  onClick,
}: CardProps) {
  const Component = onClick ? 'button' : 'div';
  return (
    <Component
      className={`${styles.card} ${styles[variant]} ${styles[`pad${padding}`]} ${onClick ? styles.clickable : ''} ${className || ''}`}
      onClick={onClick}
    >
      {children}
    </Component>
  );
}
