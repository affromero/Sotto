'use client';

import { useState } from 'react';
import type { VocabularyEntryData } from '@/types/vocabulary';
import styles from './VocabularyList.module.css';

interface VocabularyListProps {
  vocabularyEntries: VocabularyEntryData[];
}

const POS_LABELS: Record<string, string> = {
  noun: 'Noun',
  verb: 'Verb',
  adjective: 'Adj',
  adverb: 'Adv',
  phrase: 'Phrase',
  expression: 'Expr',
};

export function VocabularyList({ vocabularyEntries }: VocabularyListProps) {
  const [expanded, setExpanded] = useState(vocabularyEntries.length <= 15);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  if (vocabularyEntries.length === 0) return null;

  const sorted = [...vocabularyEntries].sort((a, b) => a.number - b.number);

  return (
    <section className={styles.root} aria-label="Vocabulary">
      <button
        className={styles.header}
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        type="button"
      >
        <h3 className={styles.heading}>
          Vocabulary
          <span className={styles.count}>({vocabularyEntries.length} words)</span>
        </h3>
        <svg
          className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className={styles.content}>
          <ul className={styles.list}>
            {sorted.map((entry) => {
              const isExpanded = expandedEntry === entry.id;
              const posLabel = entry.partOfSpeech
                ? (POS_LABELS[entry.partOfSpeech.toLowerCase()] ?? entry.partOfSpeech)
                : null;

              return (
                <li key={entry.id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.entryButton}
                    onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? `Collapse ${entry.word}` : `Expand ${entry.word}`}
                  >
                    <div className={styles.entryMain}>
                      <span className={styles.word}>{entry.word}</span>
                      <span className={styles.translation}>{entry.translation}</span>
                    </div>
                    <div className={styles.entryMeta}>
                      {posLabel && <span className={styles.posBadge}>{posLabel}</span>}
                      {entry.pronunciation && (
                        <span className={styles.pronunciation}>({entry.pronunciation})</span>
                      )}
                    </div>
                  </button>
                  {isExpanded && entry.exampleSentence && (
                    <div className={styles.exampleSection}>
                      <p className={styles.example}>{entry.exampleSentence}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
