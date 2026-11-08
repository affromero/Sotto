'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WritingPromptData, WritingResponse } from '../classTypes';
import {
  retainedLearningProgress,
  captureLearningAuthority,
  learningAuthorityIsCurrent,
  learningBindingIsCurrent,
  useLearningProgress,
  type ClassProgressBinding,
} from '../progress/useLearningProgress';

interface WritingDraft {
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
  progressRecovery?: { endpoint: string; material: string; error: string };
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
  onGraded?: (promptId: string, response: WritingResponse) => void,
  progressRevision = 0,
  material = '',
  binding?: ClassProgressBinding | null
): WritingDrafts {
  const [drafts, setDrafts] = useState<Record<string, WritingDraft>>(() =>
    Object.fromEntries(
      prompts.map((prompt) => [
        prompt.id,
        {
          text:
            retainedLearningProgress(
              endpointBase.replace(/\/writing$/, ''),
              { writingDrafts: { [prompt.id]: prompt.savedDraft ?? prompt.response?.text ?? '' } },
              progressRevision,
              material,
              binding
            ).writingDrafts?.[prompt.id] ?? '',
          submittedText: prompt.response ? trimmed(prompt.response.text) : undefined,
          result:
            trimmed(
              retainedLearningProgress(
                endpointBase.replace(/\/writing$/, ''),
                {
                  writingDrafts: { [prompt.id]: prompt.savedDraft ?? prompt.response?.text ?? '' },
                },
                progressRevision,
                material,
                binding
              ).writingDrafts?.[prompt.id] ?? ''
            ) === trimmed(prompt.response?.text ?? '')
              ? (prompt.response ?? null)
              : null,
        },
      ])
    )
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const saveError = useLearningProgress(
    endpointBase.replace(/\/writing$/, ''),
    {
      writingDrafts: Object.fromEntries(
        Object.entries(drafts).map(([id, draft]) => [id, draft.text])
      ),
    },
    true,
    progressRevision,
    material,
    binding
  );

  // submit() reads the latest drafts without being re-created on every keystroke.
  const latest = useRef(drafts);
  const submitInFlight = useRef(false);
  const pendingGrades = useRef(
    new Map<
      string,
      {
        text: string;
        result: WritingResponse;
        endpoint: string;
        binding: ClassProgressBinding | null | undefined;
      }
    >()
  );
  useLayoutEffect(() => {
    latest.current = drafts;
  }, [drafts]);

  const setText = useCallback((promptId: string, text: string) => {
    const update = (current: Record<string, WritingDraft>) => ({
      ...current,
      [promptId]: {
        ...(current[promptId] ?? { result: null }),
        text,
        result:
          trimmed(text) === current[promptId]?.submittedText
            ? (current[promptId]?.result ?? null)
            : null,
      },
    });
    latest.current = update(latest.current);
    setDrafts(update);
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
      if (submitInFlight.current) return false;
      const authorityEndpoint = endpointBase.replace(/\/writing$/, '');
      const authority = captureLearningAuthority(authorityEndpoint);
      if (authority === null || !learningBindingIsCurrent(authorityEndpoint, binding)) {
        setError('Check the class status before checking your writing. Your drafts are retained.');
        return false;
      }
      const current = latest.current;
      const retained = new Map(pendingGrades.current);
      if (
        [...retained.values()].some(
          (receipt) =>
            receipt.endpoint !== authorityEndpoint ||
            receipt.binding?.expectedAttempt !== binding?.expectedAttempt ||
            receipt.binding?.taskMaterialRevision !== binding?.taskMaterialRevision ||
            Boolean(receipt.binding) !== Boolean(binding)
        )
      ) {
        setError('This grade belongs to different class material. Your drafts are retained.');
        return false;
      }
      if (Object.values(current).some((draft) => trimmed(draft.text).length < MIN_CHARS)) {
        setError('Write an answer for every writing exercise before finishing.');
        return false;
      }
      const ids = includingUnchanged
        ? Object.entries(current)
            .filter(([, draft]) => {
              const value = trimmed(draft.text);
              return value.length >= MIN_CHARS && value.length <= MAX_CHARS;
            })
            .filter(([id, draft]) => retained.get(id)?.text !== trimmed(draft.text))
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
            .filter(([id, draft]) => retained.get(id)?.text !== trimmed(draft.text))
            .map(([id]) => id)
            .sort();

      setError('');
      for (const [id, receipt] of retained) {
        if (!current[id]) continue;
        const sameText = trimmed(latest.current[id]?.text ?? '') === receipt.text;
        const apply = (existing: Record<string, WritingDraft>) => ({
          ...existing,
          [id]: {
            text: existing[id]?.text ?? receipt.text,
            submittedText: receipt.text,
            result:
              trimmed(existing[id]?.text ?? receipt.text) === receipt.text ? receipt.result : null,
          },
        });
        latest.current = apply(latest.current);
        setDrafts(apply);
        if (sameText) onGraded?.(id, receipt.result);
        pendingGrades.current.delete(id);
      }

      if (ids.length === 0) return true;

      submitInFlight.current = true;
      setIsSubmitting(true);
      setError('');

      try {
        for (const id of ids) {
          if (!learningAuthorityIsCurrent(authorityEndpoint, authority)) {
            setError('The class changed while checking writing. Your drafts are retained.');
            return false;
          }
          const text = trimmed(current[id]?.text ?? '');
          if (trimmed(latest.current[id]?.text ?? '') !== text) {
            setError('Your writing changed while checking. Review it before checking again.');
            return false;
          }
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

          if (
            !learningAuthorityIsCurrent(authorityEndpoint, authority) ||
            !learningBindingIsCurrent(authorityEndpoint, binding)
          ) {
            pendingGrades.current.set(id, {
              text,
              result: graded,
              endpoint: authorityEndpoint,
              binding: binding ? { ...binding } : binding,
            });
            setError(
              'The class changed while checking writing. Your drafts and grade are retained.'
            );
            return false;
          }
          const apply = (existing: Record<string, WritingDraft>) => ({
            ...existing,
            [id]: {
              text: existing[id]?.text ?? text,
              submittedText: text,
              result: trimmed(existing[id]?.text ?? text) === text ? graded : null,
            },
          });
          latest.current = apply(latest.current);
          setDrafts(apply);
          if (trimmed(latest.current[id]?.text ?? text) === text) onGraded?.(id, graded);
        }

        return true;
      } catch {
        setError('Network error. Please try again.');
        return false;
      } finally {
        submitInFlight.current = false;
        setIsSubmitting(false);
      }
    },
    [endpointBase, onGraded, binding]
  );

  return {
    drafts,
    setText,
    changedIds,
    hasChanges: changedIds.length > 0,
    isOverLimit,
    isSubmitting,
    error,
    progressRecovery: {
      endpoint: endpointBase.replace(/\/writing$/, ''),
      material,
      error: saveError,
    },
    submit,
  };
}
