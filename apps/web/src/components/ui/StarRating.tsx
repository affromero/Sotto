'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import styles from './StarRating.module.css';

interface StarRatingProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  size?: number;
  label?: string;
}

export function StarRating({ value, onChange, disabled = false, size = 24, label }: StarRatingProps) {
  const [hoverValue, setHoverValue] = useState(0);
  const displayValue = hoverValue || value;

  return (
    <div
      className={styles.root}
      role="radiogroup"
      aria-label={label || 'Rating'}
      onMouseLeave={() => setHoverValue(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={`${styles.star} ${star <= displayValue ? styles.starFilled : ''}`}
          onClick={() => !disabled && onChange(star)}
          onMouseEnter={() => !disabled && setHoverValue(star)}
          disabled={disabled}
          role="radio"
          aria-checked={star === value}
          aria-label={`${star} star${star !== 1 ? 's' : ''}`}
        >
          <Star
            size={size}
            fill={star <= displayValue ? 'currentColor' : 'none'}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  );
}
