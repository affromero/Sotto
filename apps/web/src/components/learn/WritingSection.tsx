'use client';

/**
 * WritingSection renders the say-it-in-writing module from the design bundle
 * (`class-writing.jsx`): a task card, a textarea, a "Check writing" button,
 * then the submitted text with inline corrections (struck-through `old`, green
 * `new`, a `why` tooltip), a ScoreDial, and feedback.
 *
 * Generalized like SpeakingExercise: it takes an `endpointBase`
 * (`/api/v1/classes/{classId}/writing` for class, `/api/v1/practice/{sessionId}/writing`
 * for practice) and appends the prompt id.
 *
 * Adaptation to our data: the design matched a fixed set of seeded errors in
 * the local draft; our backend grades synchronously and returns the authoritative
 * corrections (`{old, new, why}`), overall score, and feedback. We render those by
 * locating each `old` substring in the submitted text to wrap it inline instead
 * of recomputing anything client-side.
 */

import { useId, useState } from 'react';
import guardStyles from '@/components/ui/LearningTextGuard.module.css';
import { learningTextGuardProps } from '@/components/ui/learningTextGuard';
import { ClassGlyph } from './ClassGlyph';
import { ContinueBar, ScoreDial } from './ClassWidgets';
import type { WritingCorrection, WritingPromptData, WritingResponse } from './classTypes';
import styles from './WritingSection.module.css';

interface WritingSectionProps {
  /** Endpoint prefix; the prompt id is appended, e.g.
   *  `/api/v1/classes/{classId}/writing` or `/api/v1/practice/{sessionId}/writing`. */
  endpointBase: string;
  prompts: WritingPromptData[];
  /** Reports the running average 0..100 score upward (class gate / rail). */
  onScore?: (score: number) => void;
  onFeedback?: (promptId: string, response: WritingResponse) => void;
  feedbackHref?: string;
  /** Class-flow gating. When `onContinue` is set, the gated ContinueBar is
   *  rendered; in practice these are omitted (the runner owns "Finish"). */
  gate?: number; // 0..100
  nextName?: string | null;
  onContinue?: () => void;
}

type CardPhase = 'editing' | 'checking' | 'checked' | 'error';

const MIN_CHARS = 8;

// ---- inline corrected text ----

interface CorrectedTextProps {
  text: string;
  corrections: WritingCorrection[];
}

/**
 * Render the submitted text with each correction's `old` span wrapped as a
 * hover-able fix. Matches are located left-to-right; a correction whose `old`
 * is not present in the text (e.g. the learner edited it away) is appended as a
 * standalone note so its guidance is never lost.
 */
function CorrectedText({ text, corrections }: CorrectedTextProps) {
  type Node = { kind: 'text'; value: string } | { kind: 'corr'; c: WritingCorrection };
  let nodes: Node[] = [{ kind: 'text', value: text }];
  const unmatched: WritingCorrection[] = [];

  for (const c of corrections) {
    if (!c.old) {
      unmatched.push(c);
      continue;
    }
    let matched = false;
    nodes = nodes.flatMap((node): Node[] => {
      if (matched || node.kind !== 'text') return [node];
      const i = node.value.indexOf(c.old);
      if (i < 0) return [node];
      matched = true;
      return [
        { kind: 'text', value: node.value.slice(0, i) },
        { kind: 'corr', c },
        { kind: 'text', value: node.value.slice(i + c.old.length) },
      ];
    });
    if (!matched) unmatched.push(c);
  }

  return (
    <>
      <p className={styles.corrected}>
        {nodes.map((node, idx) =>
          node.kind === 'text' ? <span key={idx}>{node.value}</span> : <Corr key={idx} c={node.c} />
        )}
      </p>
      {unmatched.length > 0 && (
        <ul className={styles.unmatchedList} aria-label="Additional notes">
          {unmatched.map((c, idx) => (
            <li key={idx} className={styles.unmatchedItem}>
              {c.old && (
                <>
                  <span className={styles.old}>{c.old}</span>
                  <span className={styles.new}>{c.new}</span>
                </>
              )}
              <span className={styles.unmatchedWhy}>{c.why}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Corr({ c }: { c: WritingCorrection }) {
  return (
    <span className={styles.corr} tabIndex={0}>
      <span className={styles.old}>{c.old}</span>
      <span className={styles.new}>{c.new}</span>
      <span className={styles.corrNote} role="tooltip">
        <span className={styles.ck}>fix</span>
        {c.why}
      </span>
    </span>
  );
}

// ---- one writing prompt card ----

interface PromptCardProps {
  endpointBase: string;
  prompt: WritingPromptData;
  index: number;
  total: number;
  onScored: (promptId: string, overall: number) => void;
  onFeedback?: (promptId: string, response: WritingResponse) => void;
  feedbackHref: string;
}

function PromptCard({
  endpointBase,
  prompt,
  index,
  total,
  onScored,
  onFeedback,
  feedbackHref,
}: PromptCardProps) {
  const [text, setText] = useState(prompt.response?.text ?? '');
  const [phase, setPhase] = useState<CardPhase>(prompt.response ? 'checked' : 'editing');
  const [result, setResult] = useState<WritingResponse | null>(prompt.response);
  const [error, setError] = useState('');
  const taResid = useId();

  async function check() {
    setPhase('checking');
    setError('');
    try {
      const res = await fetch(`${endpointBase}/${prompt.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not check your writing. Please try again.');
        setPhase('error');
        return;
      }
      const data = (await res.json()) as Omit<WritingResponse, 'text'>;
      const graded: WritingResponse = {
        text,
        overallScore: data.overallScore,
        corrections: data.corrections ?? [],
        feedback: data.feedback,
      };
      setResult(graded);
      setPhase('checked');
      onScored(prompt.id, Math.round((graded.overallScore ?? 0) * 100));
      onFeedback?.(prompt.id, graded);
    } catch {
      setError('Network error. Please try again.');
      setPhase('error');
    }
  }

  function edit() {
    setPhase('editing');
  }

  const overall = result ? Math.round((result.overallScore ?? 0) * 100) : 0;
  const issueCount = result?.corrections.length ?? 0;
  const isChecking = phase === 'checking';
  const showEditor = phase === 'editing' || phase === 'checking' || phase === 'error';

  return (
    <article
      className={styles.card}
      id={`writing-prompt-${prompt.id}`}
      aria-label={`Writing prompt ${index + 1} of ${total}`}
    >
      <div className={styles.writePrompt}>
        <div className={styles.writeFrom}>Prompt {index + 1}</div>
        <div
          className={`${styles.writeBubble} ${guardStyles.guarded}`}
          {...learningTextGuardProps<HTMLDivElement>()}
        >
          {prompt.task}
        </div>
        {prompt.guidance && (
          <div
            className={`${styles.writeTask} ${guardStyles.guarded}`}
            {...learningTextGuardProps<HTMLDivElement>()}
          >
            {prompt.guidance}
          </div>
        )}
        {prompt.ideas && prompt.ideas.length > 0 && (
          <details className={styles.ideas}>
            <summary className={styles.ideasSummary}>Need ideas?</summary>
            <ul
              className={`${styles.ideasList} ${guardStyles.guarded}`}
              {...learningTextGuardProps<HTMLUListElement>()}
            >
              {prompt.ideas.map((idea) => (
                <li key={idea}>{idea}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {showEditor ? (
        <>
          <label className={styles.srOnly} htmlFor={taResid}>
            Your written response for prompt {index + 1}
          </label>
          <textarea
            id={taResid}
            className={styles.writer}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write your response…"
            disabled={isChecking}
            lang="auto"
          />
          <div className={styles.writeCount} aria-live="polite">
            {text.trim().length} characters
          </div>

          {phase === 'error' && error && (
            <p className={styles.errorBanner} role="alert">
              {error}
            </p>
          )}

          <div className={styles.cactions}>
            <span className={styles.grow} />
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={text.trim().length < MIN_CHARS || isChecking}
              aria-disabled={text.trim().length < MIN_CHARS || isChecking}
              aria-busy={isChecking}
              onClick={() => void check()}
            >
              {isChecking ? 'Checking…' : 'Check writing'} <ClassGlyph name="check" size={16} />
            </button>
          </div>
        </>
      ) : (
        result && (
          <div className={styles.results}>
            <CorrectedText text={result.text} corrections={result.corrections} />

            <div className={styles.writeFeedback}>
              <div className={styles.wfDial}>
                <ScoreDial value={overall} size={64} />
              </div>
              <p className={styles.writePraise}>
                {result.feedback}
                <span className={styles.tally}>
                  {issueCount === 0
                    ? 'no issues found, clean'
                    : `${issueCount} correction${issueCount > 1 ? 's' : ''} · hover to see why`}
                </span>
              </p>
              <a className={styles.feedbackLink} href={feedbackHref}>
                Go to Feedback Clinic
              </a>
            </div>

            <div className={styles.cactions}>
              <button type="button" className={`${styles.btn} ${styles.btnBare}`} onClick={edit}>
                <ClassGlyph name="back" size={16} /> Edit again
              </button>
              <span className={styles.grow} />
            </div>
          </div>
        )
      )}
    </article>
  );
}

// ---- module ----

export function WritingSection({
  endpointBase,
  prompts,
  onScore,
  onFeedback,
  feedbackHref = '#feedback-clinic',
  gate,
  nextName = null,
  onContinue,
}: WritingSectionProps) {
  // overall score per prompt id (0..100)
  const [scores, setScores] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const p of prompts) {
      if (p.response) initial[p.id] = Math.round((p.response.overallScore ?? 0) * 100);
    }
    return initial;
  });

  function handleScored(promptId: string, value: number) {
    setScores((prev) => {
      const next = { ...prev, [promptId]: value };
      if (onScore) {
        const vals = Object.values(next);
        const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
        onScore(avg);
      }
      return next;
    });
  }

  if (prompts.length === 0) {
    return (
      <p className={styles.empty} role="status">
        No writing prompts available for this section.
      </p>
    );
  }

  const scoredVals = prompts
    .map((p) => scores[p.id])
    .filter((v): v is number => typeof v === 'number');
  const allChecked = scoredVals.length === prompts.length;
  const overall = scoredVals.length
    ? Math.round(scoredVals.reduce((a, b) => a + b, 0) / scoredVals.length)
    : 0;
  const resolvedGate = gate ?? 70;
  const passed = allChecked && overall >= resolvedGate;

  return (
    <section className={styles.root} aria-label="Writing exercise">
      <div className={styles.header}>
        <div className={styles.eyebrow}>
          <span className={styles.eyebrowIdx}>{onContinue ? '04 ·' : 'Writing ·'}</span> Writing
        </div>
        <h1 className={styles.title}>Write back, in your hand.</h1>
        <p className={styles.modLede}>
          A quick reply. The agent reads it the way a patient friend would, marking only what
          matters and telling you why. Hover a fix to see the reason.
        </p>
      </div>

      <ol className={styles.promptList}>
        {prompts.map((prompt, idx) => (
          <li key={prompt.id} className={styles.promptItem}>
            <PromptCard
              endpointBase={endpointBase}
              prompt={prompt}
              index={idx}
              total={prompts.length}
              onScored={handleScored}
              onFeedback={onFeedback}
              feedbackHref={feedbackHref}
            />
          </li>
        ))}
      </ol>

      {onContinue && (
        <ContinueBar
          passed={passed}
          gate={resolvedGate}
          score={overall}
          nextName={nextName}
          onContinue={onContinue}
        />
      )}
    </section>
  );
}
