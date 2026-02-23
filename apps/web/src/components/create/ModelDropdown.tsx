'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronUp } from 'lucide-react';
import styles from './ModelDropdown.module.css';

export interface ModelOption {
  id: string;
  displayName: string;
  badge?: string;
  group?: string;
  unavailable?: boolean;
}

interface ModelDropdownProps {
  label: string;
  options: ModelOption[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
  loading?: boolean;
}

export function ModelDropdown({
  label,
  options,
  value,
  onChange,
  disabled,
  loading,
}: ModelDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Position the fixed dropdown relative to the trigger
  useEffect(() => {
    if (!isOpen || !containerRef.current || !dropdownRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dropdown = dropdownRef.current;
    const spaceAbove = rect.top - 12;

    dropdown.style.left = `${rect.left}px`;
    dropdown.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    dropdown.style.maxHeight = `${Math.min(360, Math.max(200, spaceAbove))}px`;
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current && !containerRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  if (loading || options.length === 0) return null;

  const selected = options.find((o) => o.id === value) ?? options[0];

  // Group options by their group field
  const groups = new Map<string, ModelOption[]>();
  for (const opt of options) {
    const key = opt.group ?? '';
    const arr = groups.get(key) ?? [];
    arr.push(opt);
    groups.set(key, arr);
  }
  const hasGroups = groups.size > 1 || (groups.size === 1 && groups.keys().next().value !== '');

  const handleSelect = (opt: ModelOption) => {
    if (opt.unavailable) return;
    onChange(opt.id);
    setIsOpen(false);
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        type="button"
        className={`${styles.trigger} ${disabled ? styles.triggerDisabled : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`${label}: ${selected?.displayName ?? 'Select'}`}
        disabled={disabled}
      >
        <span className={styles.triggerLabel}>{selected?.displayName ?? label}</span>
        {!disabled && <ChevronUp size={14} className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`} />}
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className={styles.dropdown}
          role="listbox"
          aria-label={label}
        >
          <div className={styles.dropdownHeader}>{label}</div>
          {hasGroups
            ? Array.from(groups.entries()).map(([group, opts]) => (
                <div key={group}>
                  {group && <div className={styles.groupHeader}>{group}</div>}
                  {opts.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="option"
                      aria-selected={opt.id === (value ?? options[0]?.id)}
                      className={`${styles.option} ${
                        opt.id === (value ?? options[0]?.id) ? styles.optionActive : ''
                      } ${opt.unavailable ? styles.optionUnavailable : ''}`}
                      onClick={() => handleSelect(opt)}
                      disabled={opt.unavailable}
                    >
                      <span className={styles.optionName}>{opt.displayName}</span>
                      {opt.badge && <span className={styles.optionBadge}>{opt.badge}</span>}
                      {opt.unavailable && <span className={styles.optionNoKey}>No key</span>}
                    </button>
                  ))}
                </div>
              ))
            : options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={opt.id === (value ?? options[0]?.id)}
                  className={`${styles.option} ${
                    opt.id === (value ?? options[0]?.id) ? styles.optionActive : ''
                  } ${opt.unavailable ? styles.optionUnavailable : ''}`}
                  onClick={() => handleSelect(opt)}
                  disabled={opt.unavailable}
                >
                  <span className={styles.optionName}>{opt.displayName}</span>
                  {opt.badge && <span className={styles.optionBadge}>{opt.badge}</span>}
                  {opt.unavailable && <span className={styles.optionNoKey}>No key</span>}
                </button>
              ))}
        </div>
      )}
    </div>
  );
}
