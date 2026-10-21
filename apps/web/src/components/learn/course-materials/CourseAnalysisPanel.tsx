'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  materialAnalysisProjectionSchema,
  type MaterialAnalysisProjection,
} from '@/lib/course-materials/client/analysis';
import { MaterialCoverage } from '@/components/placement/MaterialCoverage';
import { MaterialAnalysisRetry } from '@/components/placement/MaterialAnalysisRetry';
import { MaterialAnalysisCancellation } from '@/components/placement/analysis-controls/MaterialAnalysisCancellation';
import styles from './CourseAnalysisPanel.module.css';

const checkpointSchema = z
  .object({
    profileId: z.string().min(1),
    courseId: z.string().min(1),
    requestId: z.uuid(),
    materialIds: z.array(z.uuid()).max(10),
    includeCourseNote: z.boolean(),
    analysisId: z.uuid().nullable(),
    pollDeadlineAt: z.number().int().positive(),
  })
  .strict();
type Checkpoint = z.infer<typeof checkpointSchema>;
interface Props {
  courseId: string;
  nativeLang: string;
  targetLang: string;
  materials: Array<{ id: string; name: string }>;
}
const terminal = new Set([
  'COMPLETE',
  'PARTIAL',
  'INSUFFICIENT_SOURCE',
  'FAILED',
  'RECOVERY_REQUIRED',
  'CANCELLED',
  'SUPERSEDED',
]);
const profileSchema = z.object({ id: z.string().min(1) });
class AnalysisReadError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export function CourseAnalysisPanel(props: Props) {
  return <OwnedCourseAnalysisPanel key={props.courseId} {...props} />;
}

function OwnedCourseAnalysisPanel({ courseId, nativeLang, targetLang, materials }: Props) {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [materialIds, setMaterialIds] = useState<string[]>([]);
  const [includeCourseNote, setIncludeCourseNote] = useState(false);
  const [analysis, setAnalysis] = useState<MaterialAnalysisProjection | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [paused, setPaused] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const saved = useRef<Checkpoint | null>(null);
  const controller = useRef<AbortController | null>(null);
  const statusRequest = useRef<AbortController | null>(null);
  const storageKey = useCallback(
    (id: string) =>
      `sotto.source-analysis.v1:${encodeURIComponent(id)}:${encodeURIComponent(courseId)}`,
    [courseId]
  );

  const persist = useCallback(
    (value: Checkpoint) => {
      window.localStorage.setItem(storageKey(value.profileId), JSON.stringify(value));
      saved.current = value;
      setHasSaved(true);
    },
    [storageKey]
  );

  async function responseBody(response: Response): Promise<unknown> {
    const result: unknown = await response.json();
    if (!response.ok) {
      const failure = z.object({ error: z.string() }).safeParse(result);
      throw new AnalysisReadError(
        failure.success ? failure.data.error : 'Could not read the saved analysis.',
        response.status
      );
    }
    return result;
  }

  const loadStatus = useCallback(async (analysisId: string, outerSignal: AbortSignal) => {
    statusRequest.current?.abort();
    const current = new AbortController();
    statusRequest.current = current;
    const signal = AbortSignal.any([outerSignal, current.signal]);
    try {
      const response = await fetch(`/api/v1/material-analyses/${analysisId}`, {
        signal,
        cache: 'no-store',
      });
      const result = materialAnalysisProjectionSchema.parse(await responseBody(response));
      signal.throwIfAborted();
      if (statusRequest.current !== current) return null;
      if (result.analysisId !== analysisId) throw new Error('The analysis receipt changed.');
      setUnavailable(false);
      setAnalysis(result);
      return result;
    } catch (cause) {
      if (current.signal.aborted && !outerSignal.aborted) return null;
      if (cause instanceof AnalysisReadError && cause.status === 404) setUnavailable(true);
      throw cause;
    } finally {
      if (statusRequest.current === current) statusRequest.current = null;
    }
  }, []);

  useEffect(() => {
    const current = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/v1/users/me', {
          signal: current.signal,
          cache: 'no-store',
        });
        const profile = profileSchema.parse(await responseBody(response));
        const serialized = window.localStorage.getItem(storageKey(profile.id));
        const checkpoint =
          serialized === null ? null : checkpointSchema.parse(JSON.parse(serialized));
        current.signal.throwIfAborted();
        if (checkpoint && (checkpoint.profileId !== profile.id || checkpoint.courseId !== courseId))
          throw new Error('The saved source analysis belongs to another learner or course.');
        saved.current = checkpoint;
        setHasSaved(checkpoint !== null);
        setProfileId(profile.id);
        setMaterialIds(checkpoint?.materialIds ?? []);
        setIncludeCourseNote(checkpoint?.includeCourseNote ?? false);
        setLoaded(true);
        if (checkpoint?.analysisId) await loadStatus(checkpoint.analysisId, current.signal);
        current.signal.throwIfAborted();
        setLoaded(true);
      } catch (cause) {
        if (!current.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not reopen saved analysis.');
      }
    })();
    return () => {
      current.abort();
      controller.current?.abort();
      statusRequest.current?.abort();
    };
  }, [courseId, loadStatus, storageKey, loadAttempt]);

  useEffect(() => {
    if (!analysis || terminal.has(analysis.status) || busy || paused) return;
    const current = new AbortController();
    const timer = window.setTimeout(() => {
      if (Date.now() >= (saved.current?.pollDeadlineAt ?? 0)) {
        setPaused(true);
        return;
      }
      void loadStatus(analysis.analysisId, current.signal).catch((cause: unknown) => {
        if (!current.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not check analysis progress.');
      });
    }, 2000);
    return () => {
      clearTimeout(timer);
      current.abort();
    };
  }, [analysis, busy, loadStatus, paused]);

  function invalidate() {
    controller.current?.abort();
    controller.current = null;
    statusRequest.current?.abort();
    statusRequest.current = null;
    saved.current = null;
    setHasSaved(false);
    if (profileId) window.localStorage.removeItem(storageKey(profileId));
    setAnalysis(null);
    setUnavailable(false);
    setPaused(false);
    setBusy(false);
    setError('');
  }

  async function analyze() {
    if (!profileId || controller.current || (!materialIds.length && !includeCourseNote)) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError('');
    try {
      const profile = profileSchema.parse(
        await responseBody(
          await fetch('/api/v1/users/me', {
            signal: current.signal,
            cache: 'no-store',
          })
        )
      );
      current.signal.throwIfAborted();
      if (profile.id !== profileId)
        throw new Error('The active learner changed. Reopen this course before analyzing.');
      let checkpoint = saved.current ?? {
        profileId,
        courseId,
        requestId: crypto.randomUUID(),
        materialIds: [...materialIds].sort(),
        includeCourseNote,
        analysisId: null,
        pollDeadlineAt: Date.now() + 7_200_000,
      };
      persist(checkpoint);
      if (!checkpoint.analysisId) {
        const response = await fetch(
          `/api/v1/courses/${encodeURIComponent(courseId)}/material-analyses`,
          {
            method: 'POST',
            signal: current.signal,
            headers: {
              'Content-Type': 'application/json',
              'x-sotto-expected-profile-id': profileId,
            },
            body: JSON.stringify({
              schemaVersion: 1,
              requestId: checkpoint.requestId,
              native: nativeLang,
              target: targetLang,
              materialIds: checkpoint.materialIds,
              includeCourseNote: checkpoint.includeCourseNote,
            }),
          }
        );
        const admitted = materialAnalysisProjectionSchema.parse(await responseBody(response));
        current.signal.throwIfAborted();
        checkpoint = { ...checkpoint, analysisId: admitted.analysisId };
        persist(checkpoint);
        setAnalysis(admitted);
      }
      if (!checkpoint.analysisId) throw new Error('The analysis receipt is missing its identity.');
      await loadStatus(checkpoint.analysisId, current.signal);
    } catch (cause) {
      if (!current.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Could not start source analysis.');
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  async function openRetry(childId: string, parentId: string) {
    if (!saved.current || saved.current.analysisId !== parentId)
      throw new Error('The source selection changed. Open its current analysis before retrying.');
    const current = new AbortController();
    controller.current?.abort();
    controller.current = current;
    setBusy(true);
    setError('');
    try {
      persist({
        ...saved.current,
        analysisId: childId,
        pollDeadlineAt: Date.now() + 7_200_000,
      });
      setPaused(false);
      await loadStatus(childId, current.signal);
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  async function clearUnavailable() {
    if (!profileId || !unavailable || controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    try {
      const profile = profileSchema.parse(
        await responseBody(
          await fetch('/api/v1/users/me', {
            signal: current.signal,
            cache: 'no-store',
          })
        )
      );
      current.signal.throwIfAborted();
      if (profile.id !== profileId)
        throw new Error('The active learner changed. Reopen this course.');
      invalidate();
      setMaterialIds([]);
      setIncludeCourseNote(false);
    } catch (cause) {
      if (!current.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : 'Could not clear the unavailable receipt.'
        );
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <section className={styles.root} aria-label="Analyze course materials">
      <h3>Find classes in your materials</h3>
      <p>
        Select up to ten saved originals and the saved editable note. Analysis may use your
        configured model and incur charges. Found focuses remain source exposure.
      </p>
      <fieldset disabled={!loaded || busy} className={styles.sources}>
        <legend>Sources to analyze</legend>
        {materials.map((material) => (
          <label key={material.id}>
            <input
              type="checkbox"
              checked={materialIds.includes(material.id)}
              disabled={!materialIds.includes(material.id) && materialIds.length >= 10}
              onChange={() => {
                invalidate();
                setMaterialIds((previous) =>
                  previous.includes(material.id)
                    ? previous.filter((id) => id !== material.id)
                    : [...previous, material.id]
                );
              }}
            />
            {material.name}
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={includeCourseNote}
            onChange={(event) => {
              invalidate();
              setIncludeCourseNote(event.target.checked);
            }}
          />
          Include the saved editable note
        </label>
      </fieldset>
      <button
        type="button"
        className={styles.action}
        disabled={!loaded || busy || (!materialIds.length && !includeCourseNote)}
        onClick={() => void analyze()}
      >
        {busy
          ? 'Opening saved analysis...'
          : hasSaved
            ? 'Open or resume saved analysis'
            : 'Analyze teaching focuses'}
      </button>
      {!loaded && error && (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            setError('');
            setLoadAttempt((value) => value + 1);
          }}
        >
          Retry learner and saved analysis
        </button>
      )}
      {unavailable && (
        <>
          <p role="status">The saved analysis is unavailable. Its request has not been replaced.</p>
          <button
            type="button"
            className={styles.action}
            disabled={busy}
            onClick={() => void clearUnavailable()}
          >
            Clear unavailable receipt and choose current sources
          </button>
        </>
      )}
      {paused && (
        <p role="status">
          Automatic checks paused after two hours. Open or resume the saved analysis to check once.
          No new analysis will be created.
        </p>
      )}
      {analysis && (
        <>
          <p role="status">
            Source analysis: {analysis.status.toLowerCase().replaceAll('_', ' ')}.
          </p>
          {analysis.coverage && <MaterialCoverage analysis={analysis} />}
          <MaterialAnalysisRetry analysis={analysis} onRetry={openRetry} />
          <MaterialAnalysisCancellation
            analysis={analysis}
            expectedProfileId={profileId ?? undefined}
          />
          {['COMPLETE', 'PARTIAL'].includes(analysis.status) && (
            <p>
              {analysis.summary?.focusCount ?? 0} source classes found. Open the learning map to
              revisit them and generate practice.
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}
