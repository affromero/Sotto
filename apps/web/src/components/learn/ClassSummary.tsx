'use client';

/**
 * ClassSummary renders the end-of-class wrap-up from the design bundle
 * (`class-summary.jsx`), driven by the authoritative `/submit` result.
 *
 * Adaptation: the design's hardcoded "tomorrow's thread" + vocab-graph stats
 * are replaced with our real submission data (overall score, sections passed)
 * and a next-step card. Failed classes can regenerate the missed sections.
 */

import { useRouter } from 'next/navigation';
import { ClassGlyph } from './ClassGlyph';
import { CefrDisclaimer } from './CefrDisclaimer';
import { ScoreDial } from './ClassWidgets';
import { skillLabel, type ClassSubmitResult } from './classTypes';
import styles from './ClassSummary.module.css';

interface ClassSummaryProps {
  lesson: { title: string; level: string; objective: string };
  order: number;
  result: ClassSubmitResult;
  regenerating: boolean;
  onRetryFailed: () => void;
}

export function ClassSummary({
  lesson,
  order,
  result,
  regenerating,
  onRetryFailed,
}: ClassSummaryProps) {
  const router = useRouter();
  const overall = Math.round(result.overallScore * 100);
  const passed = result.passed;

  return (
    <div className={styles.root}>
      <div className={styles.segEnter}>
        <div className={styles.eyebrow}>
          <span className={styles.eyebrowIdx}>★ ·</span> Class complete
        </div>
        <h1 className={styles.title}>
          {passed ? (
            <>
              An hour, <em>well spent</em>.
            </>
          ) : (
            <>
              Close: <em>one more pass</em>.
            </>
          )}
        </h1>
        <p className={styles.modLede}>
          You moved through all four skills of &ldquo;{lesson.title}.&rdquo; Here&rsquo;s what held
          and what unlocked.
        </p>

        <div className={styles.wrapHero}>
          <div className={styles.wrapTop}>
            <div className={styles.wrapLesson}>
              {lesson.level} · Class {order}
              <span>{lesson.title}</span>
            </div>
            <div className={styles.wrapTime}>
              <ClassGlyph name="clock" size={14} /> {overall}% overall
            </div>
          </div>

          <div className={styles.wrapScores}>
            {result.sections.map((s) => (
              <div className={styles.ws} key={s.id}>
                <ScoreDial value={Math.round(s.score * 100)} size={66} />
                <div className={styles.wsName}>{skillLabel(s.skill)}</div>
              </div>
            ))}
          </div>

          <div className={`${styles.wrapUnlock} ${passed ? '' : styles.wrapUnlockPending}`}>
            <ClassGlyph name={passed ? 'gate' : 'spark'} size={18} />
            <div className={styles.wuText}>
              {passed ? (
                <>
                  Your <b>{lesson.level} gate</b> cleared. The next class is ready when you are.
                </>
              ) : (
                <>
                  {result.passedSections} of {result.totalSections} sections cleared. Retry the
                  missed ones to open the <b>{lesson.level} gate</b>.
                </>
              )}
            </div>
          </div>

          <div className={styles.wrapGrid}>
            <div className={styles.wrapStat}>
              <div className={styles.wstLabel}>
                <ClassGlyph name="check" size={13} /> Sections
              </div>
              <div className={styles.wstVal}>
                {result.passedSections} / {result.totalSections}
              </div>
              <div className={styles.wstSub}>cleared this attempt</div>
            </div>
            <div className={styles.wrapStat}>
              <div className={styles.wstLabel}>
                <ClassGlyph name="graph" size={13} /> Overall
              </div>
              <div className={styles.wstVal}>{overall}%</div>
              <div className={styles.wstSub}>across all four skills</div>
            </div>
          </div>
        </div>

        <CefrDisclaimer variant="compact" />

        <div className={styles.cactions}>
          {passed ? (
            <>
              <span className={styles.grow} />
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => router.push('/learn')}
              >
                Back to courses <ClassGlyph name="arrow" size={16} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnBare}`}
                onClick={() => router.push('/learn')}
              >
                <ClassGlyph name="back" size={15} /> Courses
              </button>
              <span className={styles.grow} />
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={onRetryFailed}
                disabled={regenerating}
                aria-disabled={regenerating}
              >
                {regenerating ? 'Preparing…' : 'Retry the missed sections'}{' '}
                <ClassGlyph name="retry" size={15} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
