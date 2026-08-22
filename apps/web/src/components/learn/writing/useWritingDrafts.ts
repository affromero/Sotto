'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { WritingPromptData, WritingResponse } from '../classTypes';

export interface WritingDraft {
  text: string;
  /** The text this prompt was last graded on; undefined until it is graded. */
  submittedText?: string;
  result: WritingResponse | null;
}

/** The route caps a written answer at 4000 characters. */
const MAX_CHARS = 4000;
const MIN_CHARS = 1;

export interface WritingDrafts {
  drafts: Record<string, WritingDraft>;
  setText: (promptId: string, text: string) => void;
  changedIds: string[];
  hasChanges: boolean;
  isOverLimit: boolean;
  isSubmitting: boolean;
  error: string;
  /**
   * Grades the prompts the learner edited. `includingUnchanged` re-grades every
   * non-empty answer instead, which is what an always-available submit falls
   * back to when nothing has moved. Resolves false when one failed.
   */
  submit: (includingUnchanged?: boolean) => Promise<boolean>;
}

const trimmed = (value: string) => value.trim();

/**
 * A screen's writing drafts, owned by the screen so one submit can send them.
 * Each draft remembers the text it was last graded on, which is what makes
 * "only what changed" possible: an untouched answer is not re-sent, and a
 * graded answer that was edited is.
 */
export function useWritingDrafts(
  prompts: WritingPromptData[],
  endpointBase: string,
  onGraded?: (promptId: string, response: WritingResponse) => void
): WritingDrafts {
  const [drafts, setDrafts] = useState<Record<string, WritingDraft>>(() =>
    Object.fromEntries(
      prompts.map((prompt) => [
        prompt.id,
        {
          text: prompt.response?.text ?? '',
          submittedText: prompt.response ? trimmed(prompt.response.text) : undefined,
          result: prompt.response ?? null,
        },
      ])
    )
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // submit() reads the latest drafts without being re-created on every keystroke.
  const latest = useRef(drafts);
  latest.current = drafts;

  const setText = useCallback((promptId: string, text: string) => {
    setDrafts((current) => ({
      ...current,
      [promptId]: { ...(current[promptId] ?? { result: null }), text },
    }));
  }, []);

  const changedIds = useMemo(
    () =>
      Object.entries(drafts)
        .filter(([, draft]) => {
          const value = trimmed(draft.text);
          return (
            value.length >= MIN_CHARS && value.length <= MAX_CHARS && value !== draft.submittedText
          );
        })
        .map(([id]) => id)
        .sort(),
    [drafts]
  );

  const isOverLimit = useMemo(
    () => Object.values(drafts).some((draft) => trimmed(draft.text).length > MAX_CHARS),
    [drafts]
  );

  const submit = useCallback(
    async (includingUnchanged = false) => {
      const current = latest.current;
      const ids = includingUnchanged
        ? Object.entries(current)
            .filter(([, draft]) => {
              const value = trimmed(draft.text);
              return value.length >= MIN_CHARS && value.length <= MAX_CHARS;
            })
            .map(([id]) => id)
            .sort()
        : Object.entries(current)
            .filter(([, draft]) => {
              const value = trimmed(draft.text);
              return (
                value.length >= MIN_CHARS &&
                value.length <= MAX_CHARS &&
                value !== draft.submittedText
              );
            })
            .map(([id]) => id)
            .sort();

      if (ids.length === 0) return true;

      setIsSubmitting(true);
      setError('');

      try {
        for (const id of ids) {
          const text = trimmed(current[id]?.text ?? '');
          const res = await fetch(`${endpointBase}/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });

          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            setError(body.error ?? 'Could not check your writing. Please try again.');
            return false;
          }

          const data = (await res.json()) as Omit<WritingResponse, 'text'>;
          const graded: WritingResponse = {
            text,
            overallScore: data.overallScore,
            corrections: data.corrections ?? [],
            feedback: data.feedback,
          };

          setDrafts((existing) => ({
            ...existing,
            [id]: { text: existing[id]?.text ?? text, submittedText: text, result: graded },
          }));
          onGraded?.(id, graded);
        }

        return true;
      } catch {
        setError('Network error. Please try again.');
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [endpointBase, onGraded]
  );

  return {
    drafts,
    setText,
    changedIds,
    hasChanges: changedIds.length > 0,
    isOverLimit,
    isSubmitting,
    error,
    submit,
  };
}
