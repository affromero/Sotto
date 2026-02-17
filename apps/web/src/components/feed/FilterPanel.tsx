'use client';

import { useState, useCallback } from 'react';
import { LANGUAGE_DISPLAY } from '@sotto/shared';
import styles from './FilterPanel.module.css';

export interface AdvancedFilters {
  depth?: string;
  audience?: string;
  tone?: string;
  language?: string;
  durationMin?: number;
  durationMax?: number;
  dateFrom?: string;
  dateTo?: string;
}

interface FilterPanelProps {
  filters: AdvancedFilters;
  onChange: (filters: AdvancedFilters) => void;
}

const DEPTH_OPTIONS = [
  { value: 'quick_overview', label: 'Quick Overview' },
  { value: 'standard', label: 'Standard' },
  { value: 'deep_dive', label: 'Deep Dive' },
];

const AUDIENCE_OPTIONS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'expert', label: 'Expert' },
];

const TONE_OPTIONS = [
  { value: 'casual', label: 'Casual' },
  { value: 'professional', label: 'Professional' },
  { value: 'socratic', label: 'Socratic' },
];

const LANGUAGE_OPTIONS = Object.entries(LANGUAGE_DISPLAY).map(([value, label]) => ({
  value,
  label,
}));

function countActiveFilters(filters: AdvancedFilters): number {
  let count = 0;
  if (filters.depth) count++;
  if (filters.audience) count++;
  if (filters.tone) count++;
  if (filters.language) count++;
  if (filters.durationMin !== undefined) count++;
  if (filters.durationMax !== undefined) count++;
  if (filters.dateFrom) count++;
  if (filters.dateTo) count++;
  return count;
}

export function FilterPanel({ filters, onChange }: FilterPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const activeCount = countActiveFilters(filters);

  const handlePillToggle = useCallback(
    (key: keyof AdvancedFilters, value: string) => {
      onChange({
        ...filters,
        [key]: filters[key] === value ? undefined : value,
      });
    },
    [filters, onChange]
  );

  const handleClear = useCallback(() => {
    onChange({});
  }, [onChange]);

  return (
    <div className={styles.root}>
      <div className={styles.toggleRow}>
        <button
          className={`${styles.toggleBtn} ${expanded ? styles.toggleBtnActive : ''}`}
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          type="button"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
          Filters
          {activeCount > 0 && (
            <span className={styles.filterCount}>{activeCount}</span>
          )}
        </button>
        {activeCount > 0 && (
          <button className={styles.clearBtn} onClick={handleClear} type="button">
            Clear all
          </button>
        )}
      </div>

      {expanded && (
        <div className={styles.panel}>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Depth</span>
            <div className={styles.pills}>
              {DEPTH_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  className={`${styles.pill} ${filters.depth === value ? styles.pillActive : ''}`}
                  onClick={() => handlePillToggle('depth', value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Audience</span>
            <div className={styles.pills}>
              {AUDIENCE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  className={`${styles.pill} ${filters.audience === value ? styles.pillActive : ''}`}
                  onClick={() => handlePillToggle('audience', value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Tone</span>
            <div className={styles.pills}>
              {TONE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  className={`${styles.pill} ${filters.tone === value ? styles.pillActive : ''}`}
                  onClick={() => handlePillToggle('tone', value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Language</span>
            <div className={styles.pills}>
              {LANGUAGE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  className={`${styles.pill} ${filters.language === value ? styles.pillActive : ''}`}
                  onClick={() => handlePillToggle('language', value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Duration</span>
            <div className={styles.rangeRow}>
              <input
                type="number"
                className={styles.rangeInput}
                placeholder="Min"
                value={filters.durationMin ?? ''}
                onChange={(e) =>
                  onChange({
                    ...filters,
                    durationMin: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                min={0}
                aria-label="Minimum duration in minutes"
              />
              <span className={styles.rangeSeparator}>to</span>
              <input
                type="number"
                className={styles.rangeInput}
                placeholder="Max"
                value={filters.durationMax ?? ''}
                onChange={(e) =>
                  onChange({
                    ...filters,
                    durationMax: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                min={0}
                aria-label="Maximum duration in minutes"
              />
              <span className={styles.rangeUnit}>min</span>
            </div>
          </div>

          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Date Range</span>
            <div className={styles.rangeRow}>
              <input
                type="date"
                className={styles.dateInput}
                value={filters.dateFrom ?? ''}
                onChange={(e) =>
                  onChange({
                    ...filters,
                    dateFrom: e.target.value || undefined,
                  })
                }
                aria-label="From date"
              />
              <span className={styles.rangeSeparator}>to</span>
              <input
                type="date"
                className={styles.dateInput}
                value={filters.dateTo ?? ''}
                onChange={(e) =>
                  onChange({
                    ...filters,
                    dateTo: e.target.value || undefined,
                  })
                }
                aria-label="To date"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
