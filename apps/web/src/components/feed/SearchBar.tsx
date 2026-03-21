'use client';

import { useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { useTrack } from '@/components/providers/EventProvider';
import styles from './SearchBar.module.css';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  resultCount?: number;
  activeFilters?: Record<string, string>;
}

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search podcasts...',
  resultCount,
  activeFilters,
}: SearchBarProps) {
  const track = useTrack();

  const handleChange = useCallback(
    (newValue: string) => {
      onChange(newValue);
      // Emit search event when results are available (caller passes resultCount)
      if (newValue.length > 0 && resultCount !== undefined) {
        track({
          eventType: 'feed.search',
          query: newValue,
          resultCount,
          filters: activeFilters,
        });
      }
    },
    [onChange, track, resultCount, activeFilters]
  );

  return (
    <div className={styles.root}>
      <Search size={18} className={styles.searchIcon} aria-hidden="true" />
      <input
        type="search"
        className={styles.input}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search podcasts"
        enterKeyHint="search"
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
