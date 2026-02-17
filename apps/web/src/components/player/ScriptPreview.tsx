'use client';

import { parseTextWithCitations } from '@/lib/citation-parser';
import type { ReferenceData } from '@/types/reference';
import styles from './ScriptPreview.module.css';

interface ScriptPreviewProps {
  turns: Array<{ speaker: string; text: string }>;
  references: ReferenceData[];
}

export function ScriptPreview({ turns, references }: ScriptPreviewProps) {
  return (
    <div className={styles.root} aria-label="Script preview">
      <div className={styles.viewport}>
        {turns.map((turn, i) => (
          <div
            key={i}
            className={`${styles.turn} ${
              turn.speaker === 'HOST' ? styles.turnHost : styles.turnExpert
            }`}
          >
            <span
              className={`${styles.speaker} ${
                turn.speaker === 'HOST' ? styles.speakerHost : styles.speakerExpert
              }`}
            >
              {turn.speaker === 'HOST' ? 'Host' : 'Expert'}
            </span>
            <p className={styles.text}>
              {parseTextWithCitations(turn.text, references)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
