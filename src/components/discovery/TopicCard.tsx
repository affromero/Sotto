'use client';

import styles from './TopicCard.module.css';

interface TopicCardProps {
  title: string;
  hook: string;
  category?: string;
  onClick: () => void;
  variant?: 'default' | 'compact';
}

export function TopicCard({ title, hook, category, onClick, variant = 'default' }: TopicCardProps) {
  return (
    <button
      type="button"
      className={`${styles.card} ${variant === 'compact' ? styles.compact : ''}`}
      onClick={onClick}
    >
      <div className={styles.content}>
        {category && <span className={styles.category}>{category}</span>}
        <span className={styles.title}>{title}</span>
        <span className={styles.hook}>{hook}</span>
      </div>
      <div className={styles.arrow} aria-hidden="true">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </button>
  );
}
