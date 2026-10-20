'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

export interface LearningMapPanelProps {
  courseId: string;
  courseName?: string;
  initialLevel?: CefrLevel;
  syncLevelInUrl?: boolean;
}

interface FocusedPractice {
  id: string;
  selection: LearningSelectionRequest;
  kind: PracticeKind;
  titles: string[];
  level: CefrLevel;
}

async function responseBody(response: Response, message: string): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
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
}: LearningMapPanelProps) {
  const [map, setMap] = useState<LearningMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [practice, setPractice] = useState<FocusedPractice | null>(null);
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
      try {
        const query = level ? `?level=${encodeURIComponent(level)}` : '';
        const response = await fetch(
          `/api/v1/courses/${encodeURIComponent(courseId)}/learning-map${query}`,
          {
            signal: controller.signal,
            cache: 'no-store',
          }
        );
        const parsed = learningMapResponseSchema.safeParse(
          await responseBody(response, 'Could not load the learning map.')
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
    [courseId, syncLevelInUrl]
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
    if (!map || loading || saving || mutation.current || practice) return;
    const parsed = learningSelectionRequestSchema.parse(selection);
    if (
      parsed.level !== map.viewedLevel ||
      parsed.catalogVersion !== map.catalogVersion ||
      learningLevels.indexOf(parsed.level) > learningLevels.indexOf(map.currentLevel)
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
          preview.selection.catalogHash !== map.catalogHash) ||
        preview.selection.level !== parsed.level ||
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

  if (practice && map)
    return (
      <section className={styles.root} aria-label="Focused practice">
        <header className={styles.practiceHeader}>
          <button
            className={styles.secondary}
            type="button"
            onClick={() => {
              setPractice(null);
              void loadMap(map.viewedLevel);
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
          courseName={courseName ?? LANGUAGE_DISPLAY[map.targetLang] ?? map.targetLang}
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
          <SourceFocusLibrary map={map} onPractice={startPractice} />
        </>
      )}
    </div>
  );
}
