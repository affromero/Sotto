'use client';

import { Search, X } from 'lucide-react';
import styles from './SearchBar.module.css';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search podcasts...',
}: SearchBarProps) {
  return (
    <div className={styles.root}>
      <Search
        size={18}
        className={styles.searchIcon}
        aria-hidden="true"
      />
      <input
        type="search"
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search podcasts"
      />
      {value.length > 0 && (
        <button
          type="button"
          className={styles.clearButton}
          onClick={() => onChange('')}
          aria-label="Clear search"
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
