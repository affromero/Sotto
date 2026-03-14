'use client';

import { parseTextWithCitations } from '@/lib/citation-parser';
import type { ReferenceData } from '@/types/reference';
import styles from './ScriptEditorMock.module.css';

interface ScriptEditorMockProps {
  turns: { speaker: string; text: string }[];
  references: ReferenceData[];
}

export function ScriptEditorMock({ turns, references }: ScriptEditorMockProps) {
  return (
    <div className={styles.mockScript}>
      <div className={styles.mockHeader}>
        <div className={styles.mockDot} aria-hidden="true" />
        <span>Script Editor</span>
      </div>
      <div className={styles.mockBody}>
        {turns.map((turn, i) => {
          const speakerKey = turn.speaker.toLowerCase().includes('host') ? 'host' : 'expert';
          return (
            <div key={i} className={styles.scriptTurn}>
              <div className={styles.scriptLineRow}>
                <span className={styles.lineNum}>{i + 1}</span>
                <div className={styles.scriptContent}>
                  <span className={styles.scriptSpeaker} data-speaker={speakerKey}>
                    {turn.speaker}
                  </span>
                  <p>{parseTextWithCitations(turn.text, references)}</p>
                </div>
              </div>
            </div>
          );
        })}
        <div className={styles.scriptActions}>
          <span className={styles.scriptBtn}>Edit</span>
          <span className={styles.scriptBtn}>Regenerate</span>
          <span className={`${styles.scriptBtn} ${styles.scriptBtnPrimary}`}>
            Generate Audio
          </span>
        </div>
      </div>
    </div>
  );
}
