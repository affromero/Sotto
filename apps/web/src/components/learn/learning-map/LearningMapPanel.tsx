'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  LANGUAGE_DISPLAY,
  advanceLearningLevelSchema,
  learningLevels,
  learningLevelSchema,
  learningMapResponseSchema,
  learningSelectionRequestSchema,
  learningSelectionPreviewSchema,
  learningLevelCompletionSchema,
  type CefrLevel,
  type LearningMapResponse,
  type LearningSelectionRequest,
  type PracticeKind,
} from '@sotto/shared';
import { PracticePanel } from '../PracticePanel';
import { LearningMap } from './LearningMap';
import { SourceFocusLibrary } from './SourceFocusLibrary';
import styles from './LearningMapPanel.module.css';
import { defaultMapView, readMapView, writeMapView, type MapViewState } from './discovery/state';
import type { PrivateSourceContext } from './discovery/private-source';
import type { SourceExposureScope } from './discovery/SourceExposure';

const unavailableSchema = z.object({
  status: z.literal('UNAVAILABLE'),
  targetLang: z.string().min(1),
});

export interface LearningMapPanelProps {
  courseId: string;
  courseName?: string;
  initialLevel?: CefrLevel;
  syncLevelInUrl?: boolean;
  sourceCourse?: { targetLang: string; currentLevel: CefrLevel };
}

interface FocusedPractice {
  id: string;
  selection: LearningSelectionRequest;
  kind: PracticeKind;
  titles: string[];
  level: CefrLevel;
}

async function responseBody(
  response: Response,
  message: string,
  received?: unknown
): Promise<unknown> {
  const body: unknown = received === undefined ? await response.json().catch(() => null) : received;
  if (!response.ok) {
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string')
      throw new Error(body.error);
    throw new Error(message);
  }
  return body;
}

function errorMessage(error: unknown, message: string) {
  return error instanceof Error ? error.message : message;
}

function readUrlLevel(): CefrLevel | undefined {
  const result = learningLevelSchema.safeParse(
    new URL(window.location.href).searchParams.get('level')
  );
  return result.success ? result.data : undefined;
}

export function LearningMapPanel(props: LearningMapPanelProps) {
  return <LearningMapController key={props.courseId} {...props} />;
}

function LearningMapController({
  courseId,
  courseName,
  initialLevel,
  syncLevelInUrl = true,
  sourceCourse,
}: LearningMapPanelProps) {
  const [map, setMap] = useState<LearningMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [practice, setPractice] = useState<FocusedPractice | null>(null);
  const [privateSource, setPrivateSource] = useState<PrivateSourceContext | null>(null);
  const [sourceExposure, setSourceExposure] = useState<SourceExposureScope | null>(null);
  const sourceTarget = sourceCourse?.targetLang;
  const sourceCurrent = sourceCourse?.currentLevel;
  const [viewState, setViewState] = useState<MapViewState>({
    ...defaultMapView,
  });
  const mapRequest = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const selectionRequest = useRef<AbortController | null>(null);
  const advanceIntent = useRef<ReturnType<typeof advanceLearningLevelSchema.parse> | null>(null);

  const loadMap = useCallback(
    async (level?: CefrLevel) => {
      if (selectionRequest.current) {
        selectionRequest.current.abort();
        if (mutation.current === selectionRequest.current) mutation.current = null;
        selectionRequest.current = null;
        setSaving(false);
      }
      mapRequest.current?.abort();
      const controller = new AbortController();
      mapRequest.current = controller;
      setLoading(true);
      setError(null);
      setPrivateSource(null);
      setSourceExposure(null);
      try {
        const query = level ? `?level=${encodeURIComponent(level)}` : '';
        const response = await fetch(
          `/api/v1/courses/${encodeURIComponent(courseId)}/learning-map${query}`,
          {
            signal: controller.signal,
            cache: 'no-store',
          }
        );
        const received: unknown = await response.json().catch(() => null);
        const unavailable = unavailableSchema.safeParse(received);
        if (
          response.status === 422 &&
          unavailable.success &&
          sourceTarget &&
          sourceCurrent &&
          unavailable.data.targetLang === sourceTarget
        ) {
          if (controller.signal.aborted) return;
          const viewedLevel =
            level && learningLevels.indexOf(level) <= learningLevels.indexOf(sourceCurrent)
              ? level
              : sourceCurrent;
          setMap(null);
          setPrivateSource({
            kind: 'PRIVATE_SOURCE',
            courseId,
            targetLang: sourceTarget,
            currentLevel: sourceCurrent,
            viewedLevel,
          });
          if (syncLevelInUrl) {
            const url = new URL(window.location.href);
            url.searchParams.set('course', courseId);
            url.searchParams.set('level', viewedLevel);
            window.history.replaceState(window.history.state, '', url);
          }
          return;
        }
        const parsed = learningMapResponseSchema.safeParse(
          await responseBody(response, 'Could not load the learning map.', received)
        );
        if (!parsed.success)
          throw new Error('The learning map response could not be read. Reload to try again.');
        if (controller.signal.aborted) return;
        if (parsed.data.courseId !== courseId || (level && parsed.data.viewedLevel !== level))
          throw new Error('The returned learning map does not match this course and level.');
        setMap(parsed.data);
        if (syncLevelInUrl) {
          const url = new URL(window.location.href);
          url.searchParams.set('course', courseId);
          url.searchParams.set('level', parsed.data.viewedLevel);
          window.history.replaceState(window.history.state, '', url);
        }
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(errorMessage(failure, 'Could not load the learning map.'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [courseId, syncLevelInUrl, sourceTarget, sourceCurrent]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (syncLevelInUrl) setViewState(readMapView(new URL(window.location.href).searchParams));
      void loadMap(initialLevel ?? (syncLevelInUrl ? readUrlLevel() : undefined));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialLevel, loadMap, syncLevelInUrl]);

  useEffect(() => {
    const onPopState = () => {
      if (syncLevelInUrl) {
        setViewState(readMapView(new URL(window.location.href).searchParams));
        void loadMap(readUrlLevel());
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [loadMap, syncLevelInUrl]);

  useEffect(
    () => () => {
      mapRequest.current?.abort();
      mutation.current?.abort();
    },
    []
  );

  async function startPractice(selection: LearningSelectionRequest, kind: PracticeKind) {
    const scope = map ?? privateSource;
    if (!scope || loading || saving || mutation.current || practice) return;
    const parsed = learningSelectionRequestSchema.parse(selection);
    if (
      parsed.level !== scope.viewedLevel ||
      parsed.catalogVersion !== (map?.catalogVersion ?? null) ||
      (!map && (parsed.nodeIds.length > 0 || !parsed.materialFocusId)) ||
      learningLevels.indexOf(parsed.level) > learningLevels.indexOf(scope.currentLevel)
    )
      throw new Error('Reload the learning map and choose an available practice level.');
    const controller = new AbortController();
    mutation.current = controller;
    selectionRequest.current = controller;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/courses/${encodeURIComponent(courseId)}/learning-map/selection`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(parsed),
        }
      );
      const preview = learningSelectionPreviewSchema.parse(
        await responseBody(response, 'Could not resolve this practice selection.')
      );
      if (controller.signal.aborted || mutation.current !== controller) return;
      if (
        (preview.selection.catalogHash !== null &&
          preview.selection.catalogHash !== map?.catalogHash) ||
        (!map &&
          (preview.selection.catalogHash !== null ||
            preview.selection.catalogVersion !== null ||
            preview.selection.objectives.length > 0)) ||
        preview.selection.level !== parsed.level ||
        preview.selection.targetLang !== scope.targetLang ||
        preview.selection.materialFocusId !== (parsed.materialFocusId ?? null) ||
        kind === 'VOCAB' ||
        !preview.availableKinds.includes(kind)
      )
        throw new Error(
          'The practice selection or available format changed. Reload the map and preview it again.'
        );
      const frozen = learningSelectionRequestSchema.parse({
        catalogVersion: preview.selection.catalogVersion,
        level: preview.selection.level,
        nodeIds: preview.selection.objectives.map((objective) => objective.id),
        ...(parsed.materialFocusId ? { materialFocusId: parsed.materialFocusId } : {}),
      });
      setPractice({
        id: crypto.randomUUID(),
        selection: frozen,
        kind,
        titles: preview.selection.objectives.map((objective) => objective.title),
        level: preview.selection.level,
      });
    } finally {
      if (selectionRequest.current === controller) selectionRequest.current = null;
      if (mutation.current === controller) {
        mutation.current = null;
        setSaving(false);
      }
    }
  }

  async function advance() {
    if (
      !map ||
      mutation.current ||
      map.viewedLevel !== map.currentLevel ||
      !map.readiness.ready ||
      map.blockers.length
    )
      return;
    const controller = new AbortController();
    mutation.current = controller;
    setSaving(true);
    setError(null);
    const previous = advanceIntent.current;
    const intent =
      previous?.expectedLevel === map.currentLevel && previous.catalogHash === map.catalogHash
        ? previous
        : advanceLearningLevelSchema.parse({
            requestId: crypto.randomUUID(),
            expectedLevel: map.currentLevel,
            catalogHash: map.catalogHash,
          });
    advanceIntent.current = intent;
    try {
      const response = await fetch(
        `/api/v1/courses/${encodeURIComponent(courseId)}/learning-map/advance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(intent),
          signal: controller.signal,
        }
      );
      const receipt = learningLevelCompletionSchema.parse(
        await responseBody(response, 'The level could not be advanced.')
      );
      if (receipt.courseId !== courseId || receipt.level !== intent.expectedLevel)
        throw new Error(
          'The completion receipt does not match this course and level. Reload its requirements.'
        );
      if (!controller.signal.aborted) await loadMap();
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(errorMessage(failure, 'Could not confirm level advancement.'));
    } finally {
      if (mutation.current === controller) mutation.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  const scope = map ?? privateSource;
  if (practice && scope)
    return (
      <section className={styles.root} aria-label="Focused practice">
        <header className={styles.practiceHeader}>
          <button
            className={styles.secondary}
            type="button"
            onClick={() => {
              setPractice(null);
              void loadMap(scope.viewedLevel);
            }}
          >
            Back to learning map
          </button>
          <p>
            Leaving this view does not delete saved practice. Find unfinished attempts in practice
            history.
          </p>
        </header>
        <p>
          Practice level: {practice.level}.{' '}
          {practice.titles.length
            ? `Objectives: ${practice.titles.join(', ')}`
            : 'Private source practice. Catalog objectives stay unassessed.'}
        </p>
        <PracticePanel
          key={practice.id}
          courseId={courseId}
          courseName={courseName ?? LANGUAGE_DISPLAY[scope.targetLang] ?? scope.targetLang}
          initialKind={practice.kind}
          initialLearningSelection={practice.selection}
          onComplete={() => {
            setPractice(null);
            void loadMap();
          }}
        />
      </section>
    );

  return (
    <div className={styles.root}>
      {!map && loading && <p role="status">Loading the learning map.</p>}
      {!map && error && (
        <div role="alert">
          <p>{error}</p>
          <button
            className={styles.secondary}
            type="button"
            disabled={loading}
            onClick={() =>
              void loadMap(initialLevel ?? (syncLevelInUrl ? readUrlLevel() : undefined))
            }
          >
            Reload learning map
          </button>
        </div>
      )}
      {map && (
        <>
          <LearningMap
            map={map}
            sourceExposure={loading || error ? null : sourceExposure}
            onClearSourceExposure={() => setSourceExposure(null)}
            onViewLevel={(level) => void loadMap(level)}
            onPractice={startPractice}
            onAdvance={advance}
            busy={loading || saving}
            error={error}
            viewState={viewState}
            onViewStateChange={(next) => {
              setViewState(next);
              if (syncLevelInUrl) {
                const url = writeMapView(
                  new URL(window.location.href),
                  next,
                  courseId,
                  map.viewedLevel
                );
                window.history.replaceState(window.history.state, '', url);
              }
            }}
          />
          {!loading && !error && (
            <SourceFocusLibrary
              key={`${map.viewedLevel}:${map.catalogHash}`}
              map={map}
              onPractice={startPractice}
              onVerifiedFocus={setSourceExposure}
            />
          )}
        </>
      )}
      {privateSource && (
        <section className={styles.privateSource} aria-label="Private source practice">
          <h1>Classes from your materials</h1>
          <p>
            No learning catalog is published for{' '}
            {LANGUAGE_DISPLAY[privateSource.targetLang] ?? privateSource.targetLang}. Your saved
            source focuses remain available for private practice. They do not establish catalog
            mastery or level readiness.
          </p>
          <p>Current level: {privateSource.currentLevel}</p>
          <label>
            Practice level
            <select
              value={privateSource.viewedLevel}
              disabled={loading || saving}
              onChange={(event) => void loadMap(learningLevelSchema.parse(event.target.value))}
            >
              {learningLevels
                .filter(
                  (level) =>
                    learningLevels.indexOf(level) <=
                    learningLevels.indexOf(privateSource.currentLevel)
                )
                .map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
            </select>
          </label>
          {error && <p role="alert">{error}</p>}
          <SourceFocusLibrary source={privateSource} onPractice={startPractice} />
        </section>
      )}
    </div>
  );
}
