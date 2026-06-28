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
import Link from 'next/link';
import { ClassGlyph } from './ClassGlyph';
import { CefrDisclaimer } from './CefrDisclaimer';
import { ScoreDial } from './ClassWidgets';
import {
  skillLabel,
  type ClassSection,
  type ClassSpeakingAlignmentToken,
  type ClassSubmitResult,
  type ClassVocabularyItem,
} from './classTypes';
import styles from './ClassSummary.module.css';

interface ClassSummaryProps {
  courseId: string;
  lesson: { title: string; level: string; objective: string };
  order: number;
  result: ClassSubmitResult;
  sections: ClassSection[];
  vocabulary: ClassVocabularyItem[];
  regenerating: boolean;
  onRetryFailed: () => void;
}

export function ClassSummary({
  courseId,
  lesson,
  order,
  result,
  sections,
  vocabulary,
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
          You moved through the class skills of &ldquo;{lesson.title}.&rdquo; Here&rsquo;s what held
          and what needs another pass.
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

        <FeedbackClinic
          courseId={courseId}
          result={result}
          sections={sections}
          vocabulary={vocabulary}
        />

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

function FeedbackClinic({
  courseId,
  result,
  sections,
  vocabulary,
}: {
  courseId: string;
  result: ClassSubmitResult;
  sections: ClassSection[];
  vocabulary: ClassVocabularyItem[];
}) {
  const weakSections = result.sections
    .filter((section) => !section.passed || section.score < 0.82)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
  const speakingFeedback = sections
    .flatMap((section) => section.prompts)
    .filter((prompt) => prompt.latestRecording?.status === 'SCORED')
    .slice(0, 3);
  const writingFeedback = sections
    .flatMap((section) => section.writingPrompts)
    .filter((prompt) => prompt.response)
    .slice(0, 2);
  const courseParam = encodeURIComponent(courseId);

  return (
    <section className={styles.clinic} aria-labelledby="feedback-clinic-title">
      <div className={styles.clinicHead}>
        <div>
          <div className={styles.eyebrow}>
            <span className={styles.eyebrowIdx}>◎ ·</span> Coach&apos;s review
          </div>
          <h2 className={styles.clinicTitle} id="feedback-clinic-title">
            Feedback Clinic
          </h2>
        </div>
        <div className={styles.clinicActions}>
          <Link
            className={`${styles.btn} ${styles.btnGhost}`}
            href={`/learn/practice?course=${courseParam}&kind=SPEAKING`}
          >
            <ClassGlyph name="mic" size={15} /> Speaking
          </Link>
          <Link
            className={`${styles.btn} ${styles.btnGhost}`}
            href={`/learn/practice?course=${courseParam}&kind=VOCAB`}
          >
            <ClassGlyph name="graph" size={15} /> Vocabulary
          </Link>
        </div>
      </div>

      <div className={styles.clinicGrid}>
        <article className={styles.clinicCard}>
          <h3>Targeted drills</h3>
          {weakSections.length > 0 ? (
            <div className={styles.drillList}>
              {weakSections.map((section) => (
                <Link
                  key={section.id}
                  className={styles.drillRow}
                  href={`/learn/practice?course=${courseParam}&kind=${encodeURIComponent(section.skill)}`}
                >
                  <span>{skillLabel(section.skill)}</span>
                  <b>{formatPercent(section.score)}</b>
                </Link>
              ))}
            </div>
          ) : (
            <p className={styles.clinicText}>No weak skill score stood out in this attempt.</p>
          )}
        </article>

        <article className={styles.clinicCard}>
          <h3>Pronunciation</h3>
          {speakingFeedback.length > 0 ? (
            <div className={styles.speechList}>
              {speakingFeedback.map((prompt) => {
                const recording = prompt.latestRecording;
                const focus =
                  recording?.phonemeScores?.filter((token) => token.op !== 'match').slice(0, 3) ??
                  [];
                return (
                  <div className={styles.speechItem} key={prompt.id}>
                    <div className={styles.speechLine}>
                      <span>{prompt.targetPhrase}</span>
                      <b>{formatPercent(recording?.overallScore ?? 0)}</b>
                    </div>
                    {recording?.transcript && (
                      <p className={styles.transcript}>&ldquo;{recording.transcript}&rdquo;</p>
                    )}
                    {recording?.rubricScores && (
                      <div className={styles.axisRow}>
                        {(['accuracy', 'fluency', 'completeness'] as const).map((axis) => (
                          <span key={axis}>
                            {axis}: {formatPercent(recording.rubricScores?.[axis] ?? 0)}
                          </span>
                        ))}
                      </div>
                    )}
                    {focus.length > 0 && (
                      <div className={styles.soundFocus}>
                        {focus.map((token, index) => (
                          <span key={`${prompt.id}-${index}`}>{formatFocusToken(token)}</span>
                        ))}
                      </div>
                    )}
                    {recording?.feedback && (
                      <p className={styles.clinicText}>{recording.feedback}</p>
                    )}
                    {prompt.referenceTtsUrl && (
                      <audio
                        className={styles.referenceAudio}
                        src={prompt.referenceTtsUrl}
                        controls
                        preload="none"
                        aria-label={`Reference pronunciation for ${prompt.targetPhrase}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={styles.clinicText}>
              Record speaking prompts to unlock voice-based feedback.
            </p>
          )}
        </article>

        <article className={styles.clinicCard}>
          <h3>Vocabulary</h3>
          {vocabulary.length > 0 ? (
            <>
              <div className={styles.vocabChips}>
                {vocabulary.slice(0, 10).map((item) => (
                  <span className={styles.vocabChip} key={item.lemma}>
                    <b>{item.lemma}</b>
                    <small>{item.gloss}</small>
                  </span>
                ))}
              </div>
              <Link
                className={`${styles.btn} ${styles.btnPrimary}`}
                href={`/learn/practice?course=${courseParam}&kind=VOCAB`}
              >
                Practice vocabulary <ClassGlyph name="arrow" size={15} />
              </Link>
            </>
          ) : (
            <p className={styles.clinicText}>No lesson vocabulary was attached to this class.</p>
          )}
        </article>

        <article className={styles.clinicCard}>
          <h3>Writing</h3>
          {writingFeedback.length > 0 ? (
            <div className={styles.writingList}>
              {writingFeedback.map((prompt) => (
                <div className={styles.writingItem} key={prompt.id}>
                  <div className={styles.speechLine}>
                    <span>{prompt.task}</span>
                    <b>{formatPercent(prompt.response?.overallScore ?? 0)}</b>
                  </div>
                  {prompt.response?.feedback && (
                    <p className={styles.clinicText}>{prompt.response.feedback}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.clinicText}>
              Complete writing prompts to receive correction feedback.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatFocusToken(token: ClassSpeakingAlignmentToken): string {
  if (token.expected && token.actual) return `${token.expected} -> ${token.actual}`;
  return token.expected ?? token.actual ?? 'sound';
}
