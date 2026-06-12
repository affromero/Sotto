'use client';

/**
 * GrammarSection — the drill card module from the design bundle
 * (`class-grammar.jsx`), adapted to our `Question` shape. Reused for READING:
 * when a question carries a `passageRef`, it renders as a passage above the
 * prompt. Client-side mastery gate accumulates correctness and reports the
 * running score upward; the authoritative grade still comes from `/submit`.
 */

import { useEffect, useMemo, useState } from 'react';
import { parseTextWithCitations } from '@/lib/citation-parser';
import type { ReferenceData } from '@/types/reference';
import { ClassGlyph } from './ClassGlyph';
import { ContinueBar, DotRail, MasteryMeter, type DotState } from './ClassWidgets';
import type { ClassQuestion } from './classTypes';
import styles from './GrammarSection.module.css';

interface GrammarSectionProps {
  skill: 'GRAMMAR' | 'READING';
  questions: ClassQuestion[];
  gate: number; // 0..100
  nextName: string | null;
  /**
   * The class's verified sources, used to resolve `[N]` markers inside a sourced
   * READING passage. Empty for curriculum classes (markers then stay plain text).
   */
  references?: ReferenceData[];
  /** Record a selected answer into the shell's answer map. */
  onAnswer: (questionId: string, selectedIndex: number) => void;
  /** Report the running 0..100 score for the rail/meter. */
  onScore: (score: number) => void;
  onContinue: () => void;
}

const SKILL_COPY: Record<'GRAMMAR' | 'READING', { eyebrow: string; title: string; lede: string }> =
  {
    GRAMMAR: {
      eyebrow: 'Grammar',
      title: 'The form that fits.',
      lede: 'Pick the option that completes each line. Reasoning lands the moment you choose — drawn from your week.',
    },
    READING: {
      eyebrow: 'Reading',
      title: 'Read, then decide.',
      lede: 'Each passage carries a question. Read closely, choose the answer it supports, and the explanation follows.',
    },
  };

export function GrammarSection({
  skill,
  questions,
  gate,
  nextName,
  references = [],
  onAnswer,
  onScore,
  onContinue,
}: GrammarSectionProps) {
  const total = questions.length;
  const [pos, setPos] = useState(0);
  // picked[questionId] = selected option index
  const [picked, setPicked] = useState<Record<string, number>>({});

  const cur = questions[pos];
  const done = pos >= total;

  const correctCount = useMemo(
    () =>
      questions.reduce((n, q) => {
        const sel = picked[q.id];
        if (sel === undefined || q.correctIndex === undefined) return n;
        return n + (sel === q.correctIndex ? 1 : 0);
      }, 0),
    [questions, picked],
  );

  const recall = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const passed = done && recall >= gate;

  useEffect(() => {
    onScore(recall);
  }, [recall, onScore]);

  function pick(optIndex: number) {
    if (!cur || picked[cur.id] !== undefined) return;
    setPicked((prev) => ({ ...prev, [cur.id]: optIndex }));
    onAnswer(cur.id, optIndex);
  }

  function next() {
    setPos((p) => p + 1);
  }

  const dotStates: DotState[] = questions.map((q, i) => {
    const sel = picked[q.id];
    if (!done && i === pos) return 'now';
    if (sel === undefined) return 'idle';
    if (q.correctIndex === undefined) return 'done';
    return sel === q.correctIndex ? 'done' : 'miss';
  });

  const copy = SKILL_COPY[skill];
  const curPicked = cur ? picked[cur.id] : undefined;
  const curCorrect = cur?.correctIndex !== undefined && curPicked === cur.correctIndex;

  return (
    <div className={styles.root}>
      <div className={styles.segEnter}>
        <div className={styles.eyebrow}>
          <span className={styles.eyebrowIdx}>{skill === 'GRAMMAR' ? '01 ·' : 'Reading ·'}</span>{' '}
          {copy.eyebrow}
        </div>
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.modLede}>{copy.lede}</p>

        <MasteryMeter value={recall} gate={gate} label="Recall" />

        <DotRail states={dotStates} countLabel={`${correctCount}/${total} correct`} />

        {!done && cur ? (
          <div className={styles.drillCard} key={cur.id}>
            {cur.passageText ? (
              <blockquote className={styles.passage}>
                {parseTextWithCitations(cur.passageText, references)}
              </blockquote>
            ) : (
              cur.passageRef && <blockquote className={styles.passage}>{cur.passageRef}</blockquote>
            )}

            <div className={styles.drillMeta}>
              <span className={styles.verb}>{skill === 'READING' ? 'comprehension' : 'choose'}</span>
              <span>
                · {pos + 1} of {total}
              </span>
            </div>

            <p className={styles.drillPrompt}>{cur.question}</p>

            <div
              className={styles.optRow}
              role="group"
              aria-label={`Options for: ${cur.question}`}
            >
              {cur.options.map((opt, idx) => {
                let optClass = styles.opt;
                if (curPicked !== undefined) {
                  if (cur.correctIndex === idx) optClass += ` ${styles.optCorrect}`;
                  else if (curPicked === idx) optClass += ` ${styles.optWrong}`;
                  else optClass += ` ${styles.optDim}`;
                }
                return (
                  <button
                    key={idx}
                    type="button"
                    className={optClass}
                    disabled={curPicked !== undefined}
                    aria-pressed={curPicked === idx}
                    aria-label={`Option ${idx + 1}: ${opt}`}
                    onClick={() => pick(idx)}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            {curPicked !== undefined && cur.explanation && (
              <div className={`${styles.drillWhy} ${curCorrect ? styles.drillWhyOk : styles.drillWhyNo}`}>
                <div className={styles.whyHead}>
                  <ClassGlyph name={curCorrect ? 'check' : 'x'} size={13} />
                  {curCorrect
                    ? 'Right'
                    : cur.correctIndex !== undefined
                      ? `Not quite. It's “${cur.options[cur.correctIndex]}”`
                      : 'Not quite'}
                </div>
                <p>{cur.explanation}</p>
              </div>
            )}

            {curPicked !== undefined && (
              <div className={styles.cactions}>
                <span className={styles.grow} />
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={next}>
                  {pos + 1 >= total ? 'See result' : 'Next'} <ClassGlyph name="arrow" size={16} />
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className={`${styles.drillCard} ${styles.segEnter}`}>
            <div className={styles.drillMeta}>
              <span className={styles.verb}>recall</span>
              <span>
                · {correctCount} of {total}
              </span>
            </div>
            <p className={styles.drillPrompt}>
              {passed ? (
                <>
                  Solid — you can tell them <em className={styles.emGood}>apart</em>.
                </>
              ) : (
                <>
                  Close. A couple still <em className={styles.emBad}>slipped</em>.
                </>
              )}
            </p>
            <div className={styles.drillEn}>
              {passed
                ? 'The distinction is holding. Carry it forward.'
                : 'Your final score is graded when you finish the class.'}
            </div>
          </div>
        )}

        <ContinueBar
          passed={passed}
          gate={gate}
          score={recall}
          nextName={nextName}
          onContinue={onContinue}
        />
      </div>
    </div>
  );
}
