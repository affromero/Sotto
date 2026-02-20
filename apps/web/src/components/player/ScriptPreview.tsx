'use client';

import { useMemo } from 'react';
import { parseTextWithCitations } from '@/lib/citation-parser';
import { getSpeakerIndex, getUniqueSpeakers } from '@/lib/speaker-colors';
import type { ReferenceData } from '@/types/reference';
import styles from './ScriptPreview.module.css';

interface ScriptPreviewProps {
  turns: Array<{ speaker: string; text: string }>;
  references: ReferenceData[];
}

export function ScriptPreview({ turns, references }: ScriptPreviewProps) {
  const speakers = useMemo(() => getUniqueSpeakers(turns), [turns]);

  return (
    <div className={styles.root} aria-label="Script preview">
      <div className={styles.viewport}>
        {turns.map((turn, i) => {
          const idx = getSpeakerIndex(turn.speaker, speakers);
          return (
            <div
              key={i}
              className={styles.turn}
              data-speaker-index={idx}
            >
              <span className={styles.speaker} data-speaker-index={idx}>
                {turn.speaker}
              </span>
              <p className={styles.text}>
                {parseTextWithCitations(turn.text, references)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
