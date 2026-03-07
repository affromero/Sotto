'use client';

import { useState } from 'react';
import styles from './SearchBar.module.css';

interface SearchBarProps {
  onSearch: (query: string, year?: number) => void;
}

const YEAR_PATTERN = /\b(\d{1,4})\s*(BCE|BC|CE|AD)?\b/i;

function parseQuery(input: string): { query: string; year?: number } {
  const match = input.match(YEAR_PATTERN);
  if (!match) return { query: input.trim() };

  const rawYear = parseInt(match[1], 10);
  const era = match[2]?.toUpperCase();
  const year = era === 'BCE' || era === 'BC' ? -rawYear : rawYear;
  const query = input.replace(YEAR_PATTERN, '').trim();

  return { query: query || input.trim(), year };
}

export function SearchBar({ onSearch }: SearchBarProps) {
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const { query, year } = parseQuery(input);
    onSearch(query, year);
  };

  return (
    <form onSubmit={handleSubmit} className={styles.root}>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Search a place... e.g. Rome 44 BCE"
        className={styles.input}
        aria-label="Search for a place"
      />
      <button type="submit" className={styles.button}>
        Explore
      </button>
    </form>
  );
}
