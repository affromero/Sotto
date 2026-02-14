'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { TagIcon } from '@/lib/tag-icons';
import styles from './InterestGrid.module.css';

interface SubTag {
  id: string;
  name: string;
  slug: string;
}

interface CategoryTag {
  id: string;
  name: string;
  slug: string;
  children: SubTag[];
}

interface InterestGridProps {
  categories: CategoryTag[];
  selectedTagIds?: string[];
  onChange?: (tagIds: string[]) => void;
}

export function InterestGrid({ categories, selectedTagIds = [], onChange }: InterestGridProps) {
  const selectedKey = selectedTagIds.join(',');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedTagIds));
  const [prevKey, setPrevKey] = useState(selectedKey);
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);

  // Sync external selectedTagIds changes
  if (selectedKey !== prevKey) {
    setPrevKey(selectedKey);
    setSelected(new Set(selectedTagIds));
  }

  // Measure the inner content of the expanded panel
  const measurePanel = useCallback(() => {
    if (panelRef.current) {
      setPanelHeight(panelRef.current.scrollHeight);
    }
  }, []);

  // Re-measure when expanded category or selections change
  useEffect(() => {
    if (expandedSlug) {
      // Defer to let DOM settle
      requestAnimationFrame(measurePanel);
    }
  }, [expandedSlug, measurePanel, selected.size]);

  const toggleExpand = (slug: string) => {
    setExpandedSlug((prev) => (prev === slug ? null : slug));
  };

  const toggleSub = (tagId: string) => {
    const next = new Set(selected);
    if (next.has(tagId)) {
      next.delete(tagId);
    } else {
      next.add(tagId);
    }
    setSelected(next);
    onChange?.(Array.from(next));
  };

  const selectAllInCategory = (children: SubTag[]) => {
    const next = new Set(selected);
    children.forEach((c) => next.add(c.id));
    setSelected(next);
    onChange?.(Array.from(next));
  };

  const clearCategory = (children: SubTag[]) => {
    const next = new Set(selected);
    children.forEach((c) => next.delete(c.id));
    setSelected(next);
    onChange?.(Array.from(next));
  };

  const getSelectedCount = (children: SubTag[]) => {
    return children.filter((c) => selected.has(c.id)).length;
  };

  // Build rows: cards + optional expanded panel after each row that contains the expanded category
  const expandedCategory = categories.find((c) => c.slug === expandedSlug);

  return (
    <div className={styles.grid} role="group" aria-label="Interest categories">
      {categories.map((cat, index) => {
        const isExpanded = expandedSlug === cat.slug;
        const count = getSelectedCount(cat.children);

        return (
          <div
            key={cat.id}
            className={styles.cardWrapper}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <button
              type="button"
              className={`${styles.card} ${isExpanded ? styles.cardExpanded : ''} ${count > 0 && !isExpanded ? styles.cardHasSelections : ''}`}
              onClick={() => toggleExpand(cat.slug)}
              aria-expanded={isExpanded}
            >
              <div className={styles.iconWrapper}>
                <TagIcon slug={cat.slug} size={48} className={styles.icon} />
              </div>
              <span className={styles.label}>{cat.name}</span>
              {count > 0 && (
                <div className={styles.badge} key={count} aria-label={`${count} selected`}>
                  {count}
                </div>
              )}
              <div className={`${styles.chevron} ${isExpanded ? styles.chevronUp : ''}`} aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M4 6l4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </button>
          </div>
        );
      })}

      {/* Expanded panel rendered as an overlay below the grid */}
      {expandedCategory && (
        <div
          className={styles.panel}
          style={{ height: panelHeight || undefined }}
        >
          <div ref={panelRef} className={styles.panelInner}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitle}>
                <TagIcon slug={expandedCategory.slug} size={24} className={styles.panelIcon} />
                <span>{expandedCategory.name}</span>
              </div>
              <button
                type="button"
                className={styles.bulkAction}
                onClick={() => {
                  const allSelected = getSelectedCount(expandedCategory.children) === expandedCategory.children.length;
                  if (allSelected) {
                    clearCategory(expandedCategory.children);
                  } else {
                    selectAllInCategory(expandedCategory.children);
                  }
                }}
              >
                {getSelectedCount(expandedCategory.children) === expandedCategory.children.length ? 'Clear' : 'Select All'}
              </button>
            </div>
            <div className={styles.chips} role="group" aria-label={`${expandedCategory.name} sub-interests`}>
              {expandedCategory.children.map((sub, subIndex) => {
                const isSelected = selected.has(sub.id);
                return (
                  <button
                    key={sub.id}
                    type="button"
                    className={`${styles.chip} ${isSelected ? styles.chipSelected : ''}`}
                    onClick={() => toggleSub(sub.id)}
                    aria-pressed={isSelected}
                    style={{ animationDelay: `${subIndex * 40}ms` }}
                  >
                    {isSelected && (
                      <svg className={styles.chipCheck} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                        <path
                          d="M2.5 7l3 3L11.5 4"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                    <span>{sub.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
