'use client';

/**
 * SourcedClassEntry — start a class from a real link/paper/video URL or one of
 * the learner's suggested interest topics. Additive to the plain "Continue"
 * affordance (StartNextClass) on the /learn course card.
 *
 * Flow: paste a link OR pick a topic chip → POST /api/courses/[courseId]/next-class
 * with `{ sourceUrl }` or `{ topic }`. 201 navigates to the new class; 409 means a
 * class is already active (navigate to it); 422 means the link couldn't be
 * read/leveled (surface the message); other failures surface a generic error.
 * Extraction + leveling takes a few seconds, so submitting shows a calm loading
 * state for the whole card.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './SourcedClassEntry.module.css';

interface SourcedClassEntryProps {
  courseId: string;
  activeClassId: string | null;
}

interface TopicSuggestion {
  label: string;
  query: string;
}

type Phase = 'idle' | 'starting';

export function SourcedClassEntry({ courseId, activeClassId }: SourcedClassEntryProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [topics, setTopics] = useState<TopicSuggestion[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Load topic suggestions lazily the first time the panel opens.
  useEffect(() => {
    if (!open || topics.length > 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/courses/${courseId}/topics`);
        if (!res.ok) return;
        const data = (await res.json()) as { topics?: TopicSuggestion[] };
        if (!cancelled && Array.isArray(data.topics)) setTopics(data.topics);
      } catch {
        // Topic suggestions are optional — a fetch failure leaves the link field usable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, topics.length, courseId]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const start = useCallback(
    async (payload: { sourceUrl: string } | { topic: string }) => {
      setError('');

      if (activeClassId) {
        router.push(`/learn/class/${activeClassId}`);
        return;
      }

      setPhase('starting');
      try {
        const res = await fetch(`/api/courses/${courseId}/next-class`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.status === 201) {
          const data = (await res.json()) as { classId: string };
          router.push(`/learn/class/${data.classId}`);
          return;
        }

        if (res.status === 409) {
          const data = (await res.json().catch(() => ({}))) as { activeClassId?: string };
          if (data.activeClassId) {
            router.push(`/learn/class/${data.activeClassId}`);
            return;
          }
          setError('Finish the current class before starting a new one.');
          setPhase('idle');
          return;
        }

        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 422) {
          setError(
            body.error ?? 'That link did not have enough readable text to build a class from.',
          );
        } else {
          setError(body.error ?? 'Something went wrong. Please try again.');
        }
        setPhase('idle');
      } catch {
        setError('Network error. Please try again.');
        setPhase('idle');
      }
    },
    [activeClassId, courseId, router],
  );

  function handleSubmitLink(e: React.FormEvent) {
    e.preventDefault();
    const url = link.trim();
    if (!url || phase === 'starting') return;
    void start({ sourceUrl: url });
  }

  const busy = phase === 'starting';

  if (!open) {
    return (
      <button
        type="button"
        className={styles.opener}
        onClick={() => setOpen(true)}
        aria-expanded={false}
      >
        <span className={styles.openerLede}>Class about…</span>
        <span className={styles.openerHint}>a link or a topic</span>
      </button>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>Class about…</span>
        <button
          type="button"
          className={styles.close}
          onClick={() => setOpen(false)}
          disabled={busy}
          aria-label="Close sourced class panel"
        >
          ✕
        </button>
      </div>

      {busy ? (
        <div className={styles.loading} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <p className={styles.loadingText}>Reading your source and leveling it for you…</p>
        </div>
      ) : (
        <>
          <form className={styles.form} onSubmit={handleSubmitLink}>
            <label className={styles.fieldLabel} htmlFor={`sourced-link-${courseId}`}>
              Paste an article, paper, or video link
            </label>
            <div className={styles.fieldRow}>
              <input
                ref={inputRef}
                id={`sourced-link-${courseId}`}
                type="url"
                inputMode="url"
                className={styles.input}
                placeholder="https://…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                aria-describedby={error ? `sourced-error-${courseId}` : undefined}
              />
              <button
                type="submit"
                className={styles.go}
                disabled={!link.trim()}
                aria-label="Build a class from this link"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </form>

          {topics.length > 0 && (
            <div className={styles.topics}>
              <span className={styles.topicsLabel}>Or start from an interest</span>
              <div className={styles.chipRow} role="group" aria-label="Suggested class topics">
                {topics.map((t) => (
                  <button
                    key={t.query}
                    type="button"
                    className={styles.chip}
                    onClick={() => void start({ topic: t.query })}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <p id={`sourced-error-${courseId}`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
