'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import styles from './OverflowMenu.module.css';

interface OverflowMenuItem {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface OverflowMenuProps {
  items: OverflowMenuItem[];
  triggerClassName?: string;
}

export function OverflowMenu({ items, triggerClassName }: OverflowMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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

  if (items.length === 0) return null;

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        className={triggerClassName}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="More actions"
        aria-expanded={isOpen}
        type="button"
      >
        <MoreHorizontal size={18} />
        <span>More</span>
      </button>

      {isOpen && (
        <div className={styles.dropdown} role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              className={`${styles.menuItem} ${item.danger ? styles.menuItemDanger : ''}`}
              onClick={() => {
                item.onClick();
                setIsOpen(false);
              }}
              role="menuitem"
              type="button"
            >
              <span className={styles.menuItemIcon}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
