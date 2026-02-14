'use client';

import { useState } from 'react';
import { TagIcon } from '@/lib/tag-icons';
import styles from './InterestGrid.module.css';

interface TagOption {
  id: string;
  name: string;
  slug: string;
}

interface InterestGridProps {
  tags: TagOption[];
  selectedTagIds?: string[];
  onChange?: (tagIds: string[]) => void;
}

export function InterestGrid({ tags, selectedTagIds = [], onChange }: InterestGridProps) {
  const selectedKey = selectedTagIds.join(',');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedTagIds));
  const [prevKey, setPrevKey] = useState(selectedKey);

  if (selectedKey !== prevKey) {
    setPrevKey(selectedKey);
    setSelected(new Set(selectedTagIds));
  }

  const toggle = (tagId: string) => {
    const next = new Set(selected);
    if (next.has(tagId)) {
      next.delete(tagId);
    } else {
      next.add(tagId);
    }
    setSelected(next);
    onChange?.(Array.from(next));
  };

  return (
    <div className={styles.grid} role="group" aria-label="Interest categories">
      {tags.map((tag, index) => {
        const isSelected = selected.has(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
            onClick={() => toggle(tag.id)}
            aria-pressed={isSelected}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className={styles.iconWrapper}>
              <TagIcon slug={tag.slug} size={48} className={styles.icon} />
            </div>
            <span className={styles.label}>{tag.name}</span>
            {isSelected && (
              <div className={styles.checkmark} aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M3 8l3.5 3.5L13 5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
