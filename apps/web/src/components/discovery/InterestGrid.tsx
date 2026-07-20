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

export interface CustomTag {
  name: string;
  parentSlug: string;
}

interface InterestGridProps {
  categories: CategoryTag[];
  selectedTagIds?: string[];
  customTags?: CustomTag[];
  onChange?: (tagIds: string[], customTags: CustomTag[]) => void;
}

export function InterestGrid({
  categories,
  selectedTagIds = [],
  customTags: initialCustomTags = [],
  onChange,
}: InterestGridProps) {
  const selectedKey = selectedTagIds.join(',');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedTagIds));
  const [prevKey, setPrevKey] = useState(selectedKey);
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const [customTags, setCustomTags] = useState<CustomTag[]>(initialCustomTags);
  const [otherInputs, setOtherInputs] = useState<Record<string, string>>({});

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

  // Re-measure when expanded category, selections, or custom tags change
  useEffect(() => {
    if (expandedSlug) {
      requestAnimationFrame(measurePanel);
    }
  }, [expandedSlug, measurePanel, selected.size, customTags.length]);

  const totalCount = selected.size + customTags.length;

  const emitChange = (nextSelected: Set<string>, nextCustom: CustomTag[]) => {
    onChange?.(Array.from(nextSelected), nextCustom);
  };

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
    emitChange(next, customTags);
  };

  const selectAllInCategory = (children: SubTag[]) => {
    const next = new Set(selected);
    children.forEach((c) => next.add(c.id));
    setSelected(next);
    emitChange(next, customTags);
  };

  const clearCategory = (children: SubTag[], categorySlug: string) => {
    const next = new Set(selected);
    children.forEach((c) => next.delete(c.id));
    setSelected(next);
    const nextCustom = customTags.filter((ct) => ct.parentSlug !== categorySlug);
    setCustomTags(nextCustom);
    emitChange(next, nextCustom);
  };

  const getSelectedCount = (children: SubTag[], categorySlug: string) => {
    const predefinedCount = children.filter((c) => selected.has(c.id)).length;
    const customCount = customTags.filter((ct) => ct.parentSlug === categorySlug).length;
    return predefinedCount + customCount;
  };

  const addCustomTag = (parentSlug: string) => {
    const value = (otherInputs[parentSlug] || '').trim();
    if (!value || value.length < 2) return;
    if (totalCount >= 20) return;

    // Prevent duplicate custom tags (case-insensitive)
    const isDuplicate = customTags.some(
      (ct) => ct.parentSlug === parentSlug && ct.name.toLowerCase() === value.toLowerCase()
    );
    if (isDuplicate) return;

    const nextCustom = [...customTags, { name: value, parentSlug }];
    setCustomTags(nextCustom);
    setOtherInputs((prev) => ({ ...prev, [parentSlug]: '' }));
    emitChange(selected, nextCustom);
  };

  const removeCustomTag = (index: number) => {
    const nextCustom = customTags.filter((_, i) => i !== index);
    setCustomTags(nextCustom);
    emitChange(selected, nextCustom);
  };

  const expandedCategory = categories.find((c) => c.slug === expandedSlug);
  const categoryCustomTags = expandedCategory
    ? customTags
        .map((ct, i) => ({ ...ct, index: i }))
        .filter((ct) => ct.parentSlug === expandedCategory.slug)
    : [];

  return (
    <div className={styles.grid} role="group" aria-label="Interest categories">
      {categories.map((cat, index) => {
        const isExpanded = expandedSlug === cat.slug;
        const count = getSelectedCount(cat.children, cat.slug);

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
              <div
                className={`${styles.chevron} ${isExpanded ? styles.chevronUp : ''}`}
                aria-hidden="true"
              >
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
        <div className={styles.panel} style={{ height: panelHeight || undefined }}>
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
                  const allSelected =
                    getSelectedCount(expandedCategory.children, expandedCategory.slug) ===
                    expandedCategory.children.length + categoryCustomTags.length;
                  if (allSelected) {
                    clearCategory(expandedCategory.children, expandedCategory.slug);
                  } else {
                    selectAllInCategory(expandedCategory.children);
                  }
                }}
              >
                {getSelectedCount(expandedCategory.children, expandedCategory.slug) ===
                expandedCategory.children.length + categoryCustomTags.length
                  ? 'Clear'
                  : 'Select All'}
              </button>
            </div>
            <div
              className={styles.chips}
              role="group"
              aria-label={`${expandedCategory.name} sub-interests`}
            >
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
                      <svg
                        className={styles.chipCheck}
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        aria-hidden="true"
                      >
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

              {/* Custom tag chips */}
              {categoryCustomTags.map((ct) => (
                <button
                  key={`custom-${ct.index}`}
                  type="button"
                  className={`${styles.chip} ${styles.chipSelected} ${styles.chipCustom}`}
                  onClick={() => removeCustomTag(ct.index)}
                  aria-label={`Remove ${ct.name}`}
                >
                  <svg
                    className={styles.chipCheck}
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M2.5 7l3 3L11.5 4"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>{ct.name}</span>
                  <svg
                    className={styles.chipRemove}
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 3l6 6M9 3l-6 6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              ))}

              {/* "Other" inline input */}
              <div className={styles.otherInput}>
                <input
                  type="text"
                  className={styles.otherField}
                  placeholder="Other..."
                  value={otherInputs[expandedCategory.slug] || ''}
                  onChange={(e) =>
                    setOtherInputs((prev) => ({ ...prev, [expandedCategory.slug]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCustomTag(expandedCategory.slug);
                    }
                  }}
                  maxLength={60}
                  disabled={totalCount >= 20}
                  aria-label={`Add custom ${expandedCategory.name} interest`}
                />
                <button
                  type="button"
                  className={styles.otherAdd}
                  onClick={() => addCustomTag(expandedCategory.slug)}
                  disabled={
                    totalCount >= 20 || (otherInputs[expandedCategory.slug] || '').trim().length < 2
                  }
                  aria-label="Add custom interest"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M8 3v10M3 8h10"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
