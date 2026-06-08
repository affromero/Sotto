'use client';

import { useRouter } from 'next/navigation';
import type { MemoryNode } from './MemoryGraph';
import styles from './MemoryNodeDetail.module.css';

interface MemoryNodeDetailProps {
  node: MemoryNode;
  onClose: () => void;
}

export function MemoryNodeDetail({ node, onClose }: MemoryNodeDetailProps) {
  const router = useRouter();
  const masteryPercent = Math.round(node.strength * 100);
  const kindLabel = node.kind === 'vocab' ? 'Vocabulary' : 'Grammar';

  function handlePractice() {
    // Navigate to the learn page; the caller can later wire the exact exercise route.
    router.push('/learn');
  }

  return (
    <aside
      className={styles.root}
      aria-label={`Details for ${node.label}`}
      role="complementary"
    >
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <span
            className={`${styles.kindBadge} ${node.kind === 'vocab' ? styles.kindVocab : styles.kindGrammar}`}
            aria-label={`Type: ${kindLabel}`}
          >
            {kindLabel}
          </span>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close node detail"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <h2 className={styles.label}>{node.label}</h2>
        {node.translation && (
          <p className={styles.translation}>{node.translation}</p>
        )}
      </header>

      <div className={styles.body}>
        <div className={styles.masteryRow}>
          <span className={styles.masteryLabel}>Mastery</span>
          <span className={styles.masteryPercent}>{masteryPercent}%</span>
        </div>
        <div
          className={styles.masteryBarTrack}
          role="meter"
          aria-label={`Mastery: ${masteryPercent}%`}
          aria-valuenow={masteryPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={styles.masteryBarFill}
            style={{ width: `${masteryPercent}%` }}
          />
        </div>

        {node.due && (
          <p className={styles.dueIndicator} role="status" aria-live="polite">
            Review due
          </p>
        )}
      </div>

      {node.due && (
        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.practiceButton}
            onClick={handlePractice}
            aria-label={`Practice ${node.label} now`}
          >
            Practice now
          </button>
        </footer>
      )}
    </aside>
  );
}
