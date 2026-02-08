'use client';

import { useMemo } from 'react';
import { Play, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { parseTextWithCitations } from '@/lib/citation-parser';
import type { ReferenceData } from '@/types/reference';
import styles from './ScriptPreview.module.css';

interface ScriptTurn {
  speaker: 'HOST' | 'EXPERT';
  text: string;
}

interface ScriptPreviewProps {
  turns: ScriptTurn[];
  references?: ReferenceData[];
  onApprove?: () => void;
  onRegenerate?: () => void;
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return 'Less than 1 min read';
  const rounded = Math.round(minutes);
  return `~${rounded} min read`;
}

export function ScriptPreview({ turns, references = [], onApprove, onRegenerate }: ScriptPreviewProps) {
  const { wordCount, readTime } = useMemo(() => {
    const totalWords = turns.reduce((sum, turn) => {
      return sum + turn.text.split(/\s+/).filter(Boolean).length;
    }, 0);
    const minutes = totalWords / 150;
    return { wordCount: totalWords, readTime: minutes };
  }, [turns]);

  const hasRefs = references.length > 0;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h3 className={styles.title}>Script Preview</h3>
        <div className={styles.meta}>
          <span className={styles.metaItem}>{wordCount.toLocaleString()} words</span>
          <span className={styles.metaDivider} aria-hidden="true" />
          <span className={styles.metaItem}>{formatDuration(readTime)}</span>
          <span className={styles.metaDivider} aria-hidden="true" />
          <span className={styles.metaItem}>{turns.length} turns</span>
          {hasRefs && (
            <>
              <span className={styles.metaDivider} aria-hidden="true" />
              <span className={styles.metaItem}>{references.length} references</span>
            </>
          )}
        </div>
      </header>

      <div className={styles.turns} role="log" aria-label="Script conversation preview">
        {turns.map((turn, index) => {
          const speakerClass = turn.speaker === 'HOST' ? styles.host : styles.expert;
          return (
            <div
              key={index}
              className={`${styles.turn} ${speakerClass}`}
            >
              <span className={`${styles.speaker} ${speakerClass}`}>
                {turn.speaker === 'HOST' ? 'Host' : 'Expert'}
              </span>
              <p className={styles.text}>
                {hasRefs
                  ? parseTextWithCitations(turn.text, references)
                  : turn.text}
              </p>
            </div>
          );
        })}
      </div>

      {(onApprove || onRegenerate) && (
        <footer className={styles.actions}>
          {onRegenerate && (
            <Button variant="ghost" onClick={onRegenerate} aria-label="Regenerate script">
              <RefreshCw size={16} aria-hidden="true" />
              Regenerate Script
            </Button>
          )}
          {onApprove && (
            <Button variant="primary" onClick={onApprove} aria-label="Generate audio from script">
              <Play size={16} aria-hidden="true" />
              Generate Audio
            </Button>
          )}
        </footer>
      )}
    </div>
  );
}
