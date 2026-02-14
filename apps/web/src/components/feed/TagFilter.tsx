'use client';

import styles from './TagFilter.module.css';

interface Tag {
  id: string;
  name: string;
  slug: string;
}

interface TagFilterProps {
  tags: Tag[];
  activeTag?: string;
  onTagSelect: (slug: string | undefined) => void;
}

export function TagFilter({ tags, activeTag, onTagSelect }: TagFilterProps) {
  return (
    <nav className={styles.root} aria-label="Filter by tag">
      <div className={styles.scrollContainer}>
        <button
          type="button"
          className={`${styles.pill} ${activeTag === undefined ? styles.active : ''}`}
          onClick={() => onTagSelect(undefined)}
          aria-pressed={activeTag === undefined}
        >
          All
        </button>
        {tags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className={`${styles.pill} ${activeTag === tag.slug ? styles.active : ''}`}
            onClick={() => onTagSelect(tag.slug)}
            aria-pressed={activeTag === tag.slug}
          >
            {tag.name}
          </button>
        ))}
      </div>
    </nav>
  );
}
