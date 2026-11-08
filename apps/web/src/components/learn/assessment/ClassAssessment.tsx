'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  classAssessmentMaterialSchema,
  classAssessmentStatusSchema,
  classAssessmentWritingStatusSchema,
  classReceiptSchema,
  type ClassAssessmentMaterial,
  type ClassAssessmentStatus,
} from '@sotto/shared';
import type { ClassSubmitResult } from '../classTypes';
import { savedAssessmentWorkSchema } from './assessment-retention';
import { AssessmentSpeakingPrompt } from './AssessmentSpeakingPrompt';
import styles from './ClassAssessment.module.css';

type WritingStatus = 'NOT_STARTED' | 'RUNNING' | 'UNRESOLVED' | 'COMPLETED' | 'FAILED';
type PendingChoices = z.infer<typeof savedAssessmentWorkSchema>['pending'];

async function readOwner(signal: AbortSignal) {
  const response = await fetch('/api/v1/users/me', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('The active profile could not be checked.');
  return z.object({ id: z.string().min(1).max(256) }).parse(await response.json()).id;
}

export function ClassAssessment({
  classId,
  classAttempt,
  onComplete,
  onBack,
}: {
  classId: string;
  classAttempt: number;
  onComplete: (result: ClassSubmitResult) => void;
  onBack: () => void;
}) {
  const base = `/api/v1/classes/${encodeURIComponent(classId)}/assessment`;
  const lifetime = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const currentAssessment = useRef<string | null>(null);
  const owner = useRef<string | null>(null);
  const complete = useRef(onComplete);
  const heldRecordings = useRef(new Set<string>());
  const [status, setStatus] = useState<ClassAssessmentStatus | null>(null);
  const [material, setMaterial] = useState<ClassAssessmentMaterial | null>(null);
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedWriting, setSavedWriting] = useState<Record<string, string>>({});
  const [writing, setWriting] = useState<Record<string, WritingStatus>>({});
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<PendingChoices>(null);
  const [canUnlock, setCanUnlock] = useState(false);
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hideSensitive, setHideSensitive] = useState(false);
  const [recoveryOnly, setRecoveryOnly] = useState(false);
  const [activeOwnerId, setActiveOwnerId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    complete.current = onComplete;
  }, [onComplete]);

  const refresh = useCallback(
    async (signal: AbortSignal) => {
      const sequence = ++generation.current;
      try {
        const userId = await readOwner(signal);
        if (owner.current && owner.current !== userId) {
          setHideSensitive(true);
          throw new Error('The active profile changed. Return to the original profile.');
        }
        const showHeldRecovery = async () => {
          if (!heldRecordings.current.size) return false;
          if ((await readOwner(signal)) !== userId) {
            setHideSensitive(true);
            throw new Error('The active profile changed. Return to the original profile.');
          }
          if (signal.aborted || sequence !== generation.current) return true;
          setHideSensitive(false);
          setRecoveryOnly(true);
          setStatus(null);
          setChecking(true);
          setError('Download or discard the local recording before continuing.');
          return true;
        };
        const response = await fetch(`${base}/status`, { signal, cache: 'no-store' });
        if (!response.ok) {
          if (await showHeldRecovery()) return;
          const cls = await fetch(`/api/v1/classes/${encodeURIComponent(classId)}`, {
            signal,
            cache: 'no-store',
          });
          if (cls.ok) {
            const saved = z
              .object({
                id: z.string(),
                attempt: z.number(),
                submitted: z.boolean(),
                submission: z.object({ receipt: classReceiptSchema.optional() }).nullable(),
              })
              .parse(await cls.json());
            const active = await readOwner(signal);
            if (
              !signal.aborted &&
              sequence === generation.current &&
              active === userId &&
              saved.id === classId &&
              saved.attempt === classAttempt &&
              saved.submitted &&
              saved.submission?.receipt?.source === 'ASSESSMENT'
            ) {
              complete.current(saved.submission.receipt);
              return;
            }
          }
          throw new Error('Assessment status could not be checked.');
        }
        const next = classAssessmentStatusSchema.parse(await response.json());
        if (next.classAttempt !== classAttempt && (await showHeldRecovery())) return;
        if (next.classAttempt !== classAttempt)
          throw new Error('The class changed. Return to the lesson.');
        let nextMaterial: ClassAssessmentMaterial | null = null;
        const nextWriting: Record<string, WritingStatus> = {};
        const savedDrafts: Record<string, string> = {};
        if (next.status === 'READY') {
          const url = `${base}/${encodeURIComponent(next.assessmentId)}`;
          const result = await fetch(url, { signal, cache: 'no-store' });
          if (!result.ok) throw new Error('Assessment questions could not be loaded.');
          nextMaterial = classAssessmentMaterialSchema.parse(await result.json());
          if (nextMaterial.id !== next.assessmentId || nextMaterial.classAttempt !== classAttempt)
            throw new Error('The assessment changed. Check its status again.');
          for (const section of nextMaterial.sections) {
            if (section.skill !== 'WRITING') continue;
            for (const prompt of section.items) {
              const saved = await fetch(`${url}/writing/${encodeURIComponent(prompt.id)}`, {
                signal,
                cache: 'no-store',
              });
              if (!saved.ok) throw new Error('Saved writing could not be checked.');
              const writingStatus = classAssessmentWritingStatusSchema.parse(await saved.json());
              nextWriting[prompt.id] = writingStatus.status;
              if (writingStatus.status !== 'NOT_STARTED')
                savedDrafts[prompt.id] = writingStatus.text;
            }
          }
          const check = await fetch(`${base}/status`, { signal, cache: 'no-store' });
          if (!check.ok) throw new Error('Assessment status could not be checked.');
          const final = classAssessmentStatusSchema.parse(await check.json());
          if (
            final.status !== 'READY' ||
            final.assessmentId !== next.assessmentId ||
            final.classAttempt !== next.classAttempt ||
            final.revision !== next.revision
          )
            throw new Error('The assessment changed. Check its status again.');
        }
        if ((await readOwner(signal)) !== userId) {
          setHideSensitive(true);
          throw new Error('The active profile changed. Return to the original profile.');
        }
        if (signal.aborted || sequence !== generation.current) return;
        const nextKey =
          nextMaterial && next.status === 'READY'
            ? `assessment:${JSON.stringify([userId, classId, classAttempt, nextMaterial.id, next.revision])}`
            : null;
        if (heldRecordings.current.size && currentAssessment.current !== nextKey) {
          setHideSensitive(false);
          setRecoveryOnly(true);
          throw new Error(
            'The assessment changed. Download or discard the local recording before continuing.'
          );
        }
        if (nextMaterial && next.status === 'READY') {
          const key = nextKey!;
          if (currentAssessment.current !== key) {
            setSpeaking({});
            let restored: z.infer<typeof savedAssessmentWorkSchema> | null = null;
            let usableStorage = true;
            try {
              const raw = sessionStorage.getItem(key);
              if (raw) restored = savedAssessmentWorkSchema.parse(JSON.parse(raw));
            } catch {
              usableStorage = false;
              setStorageError(true);
            }
            setChoices(restored?.choices ?? {});
            setDrafts({ ...savedDrafts, ...(restored?.drafts ?? {}) });
            setPending(restored?.pending ?? null);
            setCanUnlock(Boolean(restored?.pending && restored.rejected));
            currentAssessment.current = key;
            setStorageKey(usableStorage ? key : null);
          } else setDrafts((previous) => ({ ...savedDrafts, ...previous }));
        }
        owner.current = userId;
        setActiveOwnerId(userId);
        setSavedWriting(savedDrafts);
        setWriting(nextWriting);
        setMaterial(nextMaterial);
        setStatus(next);
        setError('');
        setHideSensitive(false);
        setRecoveryOnly(false);
        setChecking(false);
      } catch (cause) {
        if (signal.aborted || sequence !== generation.current) return;
        if (heldRecordings.current.size && owner.current) {
          try {
            const active = await readOwner(signal);
            if (!signal.aborted && sequence === generation.current && active === owner.current) {
              setHideSensitive(false);
              setRecoveryOnly(true);
            }
          } catch {
            // Keep the previous learner's material hidden until their profile can be checked.
          }
        }
        if (signal.aborted || sequence !== generation.current) return;
        setStatus(null);
        setChecking(true);
        setError(
          cause instanceof Error ? cause.message : 'Assessment status could not be checked.'
        );
      }
    },
    [base, classAttempt, classId]
  );

  useEffect(() => {
    const start = () => {
      lifetime.current?.abort();
      const controller = new AbortController();
      lifetime.current = controller;
      setBusy(false);
      setChecking(true);
      setHideSensitive(true);
      void refresh(controller.signal);
    };
    start();
    const onFocus = () => start();
    window.addEventListener('focus', onFocus);
    return () => {
      lifetime.current?.abort();
      generation.current += 1;
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!storageKey) return;
    let current = true;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ choices, drafts, pending, rejected: canUnlock })
      );
      queueMicrotask(() => {
        if (current) setStorageError(false);
      });
    } catch {
      queueMicrotask(() => {
        if (current) setStorageError(true);
      });
    }
    return () => {
      current = false;
    };
  }, [storageKey, choices, drafts, pending, canUnlock]);

  useEffect(() => {
    if (status?.status !== 'PENDING' && !Object.values(writing).includes('RUNNING')) return;
    const timer = window.setTimeout(() => {
      if (lifetime.current) void refresh(lifetime.current.signal);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [status, writing, refresh]);

  async function prepare() {
    if (status?.status !== 'AVAILABLE' || !lifetime.current || busy) return;
    const signal = lifetime.current.signal;
    setBusy(true);
    try {
      const response = await fetch(`${base}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ classAttempt: status.classAttempt, revision: status.revision }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          const detail = z
            .object({ error: z.string().max(500) })
            .safeParse(await response.json().catch(() => null));
          if (detail.success) throw new Error(detail.data.error);
        }
        throw new Error('Preparation could not be confirmed. Check the saved status.');
      }
      await refresh(signal);
    } catch (cause) {
      if (!signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Preparation could not be confirmed.');
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  async function saveWriting(promptId: string) {
    if (!material || !lifetime.current || busy) return;
    const signal = lifetime.current.signal;
    setBusy(true);
    try {
      const response = await fetch(
        `${base}/${encodeURIComponent(material.id)}/writing/${encodeURIComponent(promptId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({ text: drafts[promptId] ?? '' }),
        }
      );
      if (!response.ok) throw new Error('Writing could not be confirmed. Check the saved status.');
      await refresh(signal);
    } catch (cause) {
      if (!signal.aborted) {
        setWriting((previous) => ({ ...previous, [promptId]: 'UNRESOLVED' }));
        setError(cause instanceof Error ? cause.message : 'Writing could not be confirmed.');
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  async function submit() {
    if (!material || !lifetime.current || busy) return;
    const signal = lifetime.current.signal;
    const exactChoices =
      pending ??
      Object.entries(choices).map(([itemId, selectedIndex]) => ({ itemId, selectedIndex }));
    try {
      if (!storageKey) throw new Error('Assessment identity is unavailable.');
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ choices, drafts, pending: exactChoices, rejected: false })
      );
    } catch {
      setStorageError(true);
      setError(
        'This browser could not retain your answers. Keep this page open and check browser storage.'
      );
      return;
    }
    setPending(exactChoices);
    setCanUnlock(false);
    setBusy(true);
    try {
      const response = await fetch(`${base}/${encodeURIComponent(material.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          choices: exactChoices,
        }),
      });
      if (signal.aborted) return;
      if (!response.ok) {
        if (response.status === 400 || response.status === 409) setCanUnlock(true);
        throw new Error('Assessment submission could not be confirmed. Retry the same submission.');
      }
      const receipt = classReceiptSchema.parse(await response.json());
      if (receipt.source !== 'ASSESSMENT')
        throw new Error('Assessment receipt could not be verified.');
      if ((await readOwner(signal)) !== owner.current) {
        setMaterial(null);
        setStatus(null);
        throw new Error('The active profile changed.');
      }
      if (!signal.aborted) {
        complete.current(receipt);
      }
    } catch (cause) {
      if (!signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Assessment could not be submitted.');
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  async function unlockAnswers() {
    if (!material || status?.status !== 'READY' || !lifetime.current || !canUnlock || busy) return;
    const signal = lifetime.current.signal;
    setBusy(true);
    try {
      const active = await readOwner(signal);
      if (active !== owner.current) throw new Error('The active profile changed.');
      const cls = await fetch(`/api/v1/classes/${encodeURIComponent(classId)}`, {
        signal,
        cache: 'no-store',
      });
      if (!cls.ok) throw new Error('The class could not be checked.');
      const saved = z
        .object({ id: z.string(), attempt: z.number(), submitted: z.boolean() })
        .parse(await cls.json());
      const current = await fetch(`${base}/status`, { signal, cache: 'no-store' });
      if (!current.ok) throw new Error('The assessment could not be checked.');
      const currentStatus = classAssessmentStatusSchema.parse(await current.json());
      if (
        saved.id !== classId ||
        saved.attempt !== classAttempt ||
        saved.submitted ||
        currentStatus.status !== 'READY' ||
        currentStatus.assessmentId !== material.id ||
        currentStatus.classAttempt !== status.classAttempt ||
        currentStatus.revision !== status.revision ||
        (await readOwner(signal)) !== active
      )
        throw new Error('The assessment changed. Check its saved status.');
      if (signal.aborted) return;
      setPending(null);
      setCanUnlock(false);
      setError('You can update your answers and submit again.');
    } catch (cause) {
      if (!signal.aborted)
        setError(cause instanceof Error ? cause.message : 'The assessment could not be checked.');
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  const items =
    material?.sections.flatMap((section) =>
      'items' in section &&
      (section.skill === 'GRAMMAR' || section.skill === 'READING' || section.skill === 'LISTENING')
        ? section.items
        : []
    ) ?? [];
  const hasDifferentDraft = Object.entries(savedWriting).some(
    ([promptId, text]) => drafts[promptId] !== undefined && drafts[promptId] !== text
  );
  const canSubmit = Boolean(
    material &&
    !checking &&
    !hasDifferentDraft &&
    items.every((item) => choices[item.id] !== undefined) &&
    material.sections.every(
      (section) =>
        (section.skill !== 'WRITING' ||
          section.items.every((item) => writing[item.id] === 'COMPLETED')) &&
        (section.skill !== 'SPEAKING' || section.items.every((item) => speaking[item.id] === true))
    )
  );

  return (
    <section className={styles.root} aria-labelledby="assessment-heading">
      <p className={styles.label}>Independent assessment</p>
      <h1 id="assessment-heading">Show what you have learned</h1>
      {error && <p role="alert">{error}</p>}
      {storageError && (
        <p role="alert">This browser could not retain a local copy of your assessment work.</p>
      )}
      {!status && !error && <p role="status">Checking your assessment…</p>}
      {status?.status === 'PRACTICE_REQUIRED' && (
        <p>Finish the practice exercises before starting the assessment.</p>
      )}
      {status?.status === 'UNRESOLVED' && (
        <p>This assessment needs recovery before it can continue.</p>
      )}
      {status?.status === 'AVAILABLE' && (
        <button type="button" disabled={busy} onClick={() => void prepare()}>
          Prepare assessment
        </button>
      )}
      {status?.status === 'PENDING' && <p role="status">Preparing your assessment…</p>}
      {(error || Object.values(writing).includes('UNRESOLVED')) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => lifetime.current && void refresh(lifetime.current.signal)}
        >
          Check saved status
        </button>
      )}
      <div hidden={hideSensitive}>
        {material?.sections.map((section) => (
          <section
            key={section.id}
            className={styles.section}
            hidden={recoveryOnly && section.skill !== 'SPEAKING'}
          >
            {!recoveryOnly && (
              <h2>{section.skill.charAt(0) + section.skill.slice(1).toLowerCase()}</h2>
            )}
            {'passageText' in section && section.passageText && <p>{section.passageText}</p>}
            {'audioAvailable' in section && section.audioAvailable && (
              <audio
                controls
                preload="none"
                aria-label="Assessment listening audio"
                src={`${base}/${encodeURIComponent(material.id)}/audio/listening/${encodeURIComponent(section.id)}`}
              />
            )}
            {section.items.map((item) => {
              if ('options' in item)
                return (
                  <fieldset key={item.id} disabled={busy || checking || pending !== null}>
                    <legend>{item.question}</legend>
                    {item.options.map((option, index) => (
                      <label key={index} className={styles.option}>
                        <input
                          type="radio"
                          name={`assessment-${item.id}`}
                          checked={choices[item.id] === index}
                          onChange={() =>
                            setChoices((previous) => ({ ...previous, [item.id]: index }))
                          }
                        />
                        {option}
                      </label>
                    ))}
                  </fieldset>
                );
              if (section.skill === 'SPEAKING')
                return (
                  <div key={item.id}>
                    {!recoveryOnly &&
                      'referenceAudioAvailable' in item &&
                      item.referenceAudioAvailable && (
                        <audio
                          controls
                          preload="none"
                          aria-label="Speaking assessment reference audio"
                          src={`${base}/${encodeURIComponent(material.id)}/audio/speaking/${encodeURIComponent(item.id)}`}
                        />
                      )}
                    {!('mode' in item) || item.mode !== 'READ_ALOUD' ? (
                      <p>Speaking assessment is not available for this task yet.</p>
                    ) : (
                      storageKey &&
                      activeOwnerId && (
                        <AssessmentSpeakingPrompt
                          task={item.task}
                          url={`${base}/${encodeURIComponent(material.id)}/speaking/${encodeURIComponent(item.id)}`}
                          storageKey={`speaking:${storageKey}:${item.id}`}
                          ownerId={activeOwnerId}
                          disabled={busy || checking || pending !== null}
                          suspended={hideSensitive || recoveryOnly}
                          recoveryOnly={recoveryOnly}
                          onStatus={(complete) =>
                            setSpeaking((previous) => ({ ...previous, [item.id]: complete }))
                          }
                          onHeld={(held) => {
                            if (held) heldRecordings.current.add(item.id);
                            else heldRecordings.current.delete(item.id);
                          }}
                        />
                      )
                    )}
                  </div>
                );
              const state = writing[item.id] ?? 'NOT_STARTED';
              return (
                <div key={item.id} className={styles.writing}>
                  <label htmlFor={`writing-${item.id}`}>{item.task}</label>
                  <textarea
                    id={`writing-${item.id}`}
                    maxLength={4000}
                    value={drafts[item.id] ?? ''}
                    disabled={busy || checking}
                    readOnly={pending !== null || state !== 'NOT_STARTED'}
                    onChange={(event) =>
                      setDrafts((previous) => ({ ...previous, [item.id]: event.target.value }))
                    }
                  />
                  {state !== 'NOT_STARTED' &&
                    savedWriting[item.id] !== undefined &&
                    drafts[item.id] !== savedWriting[item.id] && (
                      <div>
                        <p role="status">
                          Your local draft differs from the saved response used for grading. Copy
                          your draft if you want to keep it, then use the saved response to
                          continue.
                        </p>
                        <p>Saved response: {savedWriting[item.id]}</p>
                        <button
                          type="button"
                          disabled={busy || checking}
                          onClick={() =>
                            setDrafts((previous) => ({
                              ...previous,
                              [item.id]: savedWriting[item.id]!,
                            }))
                          }
                        >
                          Use saved response
                        </button>
                      </div>
                    )}
                  {state === 'NOT_STARTED' ? (
                    <button
                      type="button"
                      disabled={
                        busy || checking || pending !== null || !(drafts[item.id] ?? '').trim()
                      }
                      onClick={() => void saveWriting(item.id)}
                    >
                      Save response
                    </button>
                  ) : (
                    <p role="status">
                      {state === 'RUNNING'
                        ? 'Checking your response…'
                        : state === 'COMPLETED'
                          ? 'Response saved.'
                          : 'Your response needs recovery before continuing.'}
                    </p>
                  )}
                </div>
              );
            })}
          </section>
        ))}
        {material && !recoveryOnly && (
          <button type="button" disabled={!canSubmit || busy} onClick={() => void submit()}>
            {pending ? 'Retry submission' : 'Submit assessment'}
          </button>
        )}
      </div>
      {pending && canUnlock && (
        <button type="button" disabled={busy} onClick={() => void unlockAnswers()}>
          Change answers
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (heldRecordings.current.size) {
            setError('Download or discard the local recording before leaving.');
            return;
          }
          onBack();
        }}
      >
        Back to practice
      </button>
    </section>
  );
}
