'use client';

import { useState } from 'react';
import { PlacementTest } from './PlacementTest';
import { NotesPlacement } from './NotesPlacement';
import { ManualPlacement } from './ManualPlacement';
import type { MaterialPlacementReference } from '@/lib/course-materials/client/analysis';
import styles from './PlacementEntry.module.css';

interface PlacementEntryProps {
  native: string;
  target: string;
}

type Mode = 'choose' | 'test' | 'notes' | 'verify' | 'manual';

/**
 * Entry point for placement: the learner either takes the multiple-choice test
 * or shares materials from their current level. The notes path can hand off to
 * the test in "verify" mode (a shorter run focused on the deduced level).
 */
export function PlacementEntry(props: PlacementEntryProps) {
  return <PlacementChooser key={`${props.native}:${props.target}`} {...props} />;
}

function PlacementChooser({ native, target }: PlacementEntryProps) {
  const [mode, setMode] = useState<Mode>('choose');
  const [verifyLevel, setVerifyLevel] = useState<string | undefined>(undefined);
  const [analysisReference, setAnalysisReference] = useState<
    MaterialPlacementReference | undefined
  >();

  if (mode === 'test') {
    return <PlacementTest native={native} target={target} />;
  }

  if (mode === 'verify') {
    return (
      <PlacementTest
        native={native}
        target={target}
        focusLevel={verifyLevel}
        analysisReference={analysisReference}
      />
    );
  }

  if (mode === 'notes') {
    return (
      <div className={styles.panel}>
        <button type="button" className={styles.back} onClick={() => setMode('choose')}>
          Back
        </button>
        <NotesPlacement
          native={native}
          target={target}
          onVerify={(level, reference) => {
            setVerifyLevel(level);
            setAnalysisReference(reference);
            setMode('verify');
          }}
        />
      </div>
    );
  }

  if (mode === 'manual') {
    return (
      <div className={styles.panel}>
        <button type="button" className={styles.back} onClick={() => setMode('choose')}>
          Back
        </button>
        <ManualPlacement native={native} target={target} />
      </div>
    );
  }

  return (
    <div className={styles.chooser}>
      <button type="button" className={styles.card} onClick={() => setMode('test')}>
        <span className={styles.cardTitle}>Take the placement test</span>
        <span className={styles.cardBody}>
          Answer a short set of adaptive questions and we will place you at the right level.
        </span>
      </button>
      <button type="button" className={styles.card} onClick={() => setMode('notes')}>
        <span className={styles.cardTitle}>I have materials from my level</span>
        <span className={styles.cardBody}>
          Paste or upload notes, a lesson, or your own writing and we will estimate your level, then
          confirm it with you.
        </span>
      </button>
      <button type="button" className={styles.card} onClick={() => setMode('manual')}>
        <span className={styles.cardTitle}>I already know my level</span>
        <span className={styles.cardBody}>
          Pick your CEFR level yourself. It is a quick start, though less accurate than the test,
          you can take the test anytime.
        </span>
      </button>
    </div>
  );
}
