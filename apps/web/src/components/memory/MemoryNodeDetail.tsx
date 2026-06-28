'use client';

import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { MemoryNode } from './MemoryGraph';
import styles from './MemoryNodeDetail.module.css';

interface MemoryNodeDetailProps {
  node: MemoryNode;
  courseId?: string;
  onClose: () => void;
  formatDate?: (value: string | null | undefined) => string;
}

const defaultFormatDate = (value: string | null | undefined): string => {
  if (!value) return 'Never';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return 'Never';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(ms));
};

export function MemoryNodeDetail({
  node,
  courseId,
  onClose,
  formatDate = defaultFormatDate,
}: MemoryNodeDetailProps) {
  const router = useRouter();
  const masteryPercent = Math.round(node.strength * 100);
  const kindLabel = node.kind === 'vocab' ? 'Vocabulary' : 'Grammar';
  const practiceKind = node.kind === 'vocab' ? 'VOCAB' : 'GRAMMAR';

  function handlePractice() {
    const courseParam = courseId ? `course=${encodeURIComponent(courseId)}&` : '';
    router.push(`/learn/practice?${courseParam}kind=${practiceKind}`);
  }

  return (
    <aside className={styles.root} aria-label={`Details for ${node.label}`} role="complementary">
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
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <h2 className={styles.label}>{node.label}</h2>
        {node.translation && <p className={styles.translation}>{node.translation}</p>}
      </header>

      <div className={styles.body}>
        <div className={styles.masteryRow}>
          <span className={styles.masteryLabel}>Mastery</span>
          <span className={styles.masteryPercent}>{masteryPercent}%</span>
        </div>
        <meter
          className={styles.masteryMeter}
          min={0}
          max={100}
          value={masteryPercent}
          aria-label={`Mastery: ${masteryPercent}%`}
        />

        <dl className={styles.facts}>
          <div>
            <dt>Level</dt>
            <dd>{node.cefrLevel ?? 'Open'}</dd>
          </div>
          <div>
            <dt>Reviews</dt>
            <dd>{node.reviewCount ?? 0}</dd>
          </div>
          <div>
            <dt>Lapses</dt>
            <dd>{node.lapseCount ?? 0}</dd>
          </div>
          <div>
            <dt>Last</dt>
            <dd>{formatDate(node.lastReviewed)}</dd>
          </div>
          <div>
            <dt>Due</dt>
            <dd>{formatDate(node.dueAt)}</dd>
          </div>
          <div>
            <dt>Added</dt>
            <dd>{formatDate(node.createdAt)}</dd>
          </div>
        </dl>

        {node.partOfSpeech && <p className={styles.note}>{node.partOfSpeech}</p>}
        {node.pronunciation && <p className={styles.note}>{node.pronunciation}</p>}

        {node.due && (
          <p className={styles.dueIndicator} role="status" aria-live="polite">
            Review due
          </p>
        )}
      </div>

      <footer className={styles.footer}>
        <button
          type="button"
          className={styles.practiceButton}
          onClick={handlePractice}
          aria-label={`Practice ${node.label} now`}
        >
          Practice {node.kind === 'vocab' ? 'vocab' : 'grammar'}
        </button>
      </footer>
    </aside>
  );
}
