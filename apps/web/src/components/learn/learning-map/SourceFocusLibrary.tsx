'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  courseAnalysisListSchema,
  sourceFocusSummarySchema,
  sourceFocusDetailSchema,
  learningSelectionPreviewSchema,
  type LearningMapResponse,
  type LearningSelectionRequest,
  type PracticeKind,
} from '@sotto/shared';
import { materialAnalysisProjectionSchema } from '@/lib/course-materials/client/analysis';
import { MaterialCoverage } from '@/components/placement/MaterialCoverage';
import { MaterialAnalysisRetry } from '@/components/placement/MaterialAnalysisRetry';
import styles from './SourceFocusLibrary.module.css';
import discoveryStyles from './discovery/MapFilters.module.css';
import { SourceObjectiveLinks } from './discovery/SourceObjectiveLinks';
import { sourceObjectiveIds, type SourceExposureScope } from './discovery/SourceExposure';
import type { PrivateSourceContext } from './discovery/private-source';

const projectionSchema = materialAnalysisProjectionSchema.extend({
  focuses: z.array(sourceFocusSummarySchema),
  nextCursor: z.string().nullable(),
});
type Projection = z.infer<typeof projectionSchema>;
type SourceList = z.infer<typeof courseAnalysisListSchema>;
type Focus = z.infer<typeof sourceFocusSummarySchema>;
type FocusDetail = z.infer<typeof sourceFocusDetailSchema>;
type Preview = z.infer<typeof learningSelectionPreviewSchema>;
interface SharedProps {
  onPractice: (selection: LearningSelectionRequest, kind: PracticeKind) => Promise<void>;
  onVerifiedFocus?: (focus: SourceExposureScope | null) => void;
}
type Props = SharedProps &
  ({ map: LearningMapResponse; source?: never } | { map?: never; source: PrivateSourceContext });
async function body(response: Response): Promise<unknown> {
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(result);
    throw new Error(error.success ? error.data.error : 'Could not read saved source classes.');
  }
  return result;
}

export function SourceFocusLibrary(props: Props) {
  const course = props.map ?? props.source;
  return (
    <CourseSourceFocusLibrary
      key={`${course.courseId}:${course.viewedLevel}:${props.map?.catalogHash ?? 'private'}`}
      {...props}
    />
  );
}

function CourseSourceFocusLibrary({ map, source, onPractice, onVerifiedFocus }: Props) {
  const course = map ?? source;
  const [analyses, setAnalyses] = useState<SourceList | null>(null);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);
  const [projection, setProjection] = useState<Projection | null>(null);
  const [selectedFocus, setSelectedFocus] = useState<Focus | null>(null);
  const [detail, setDetail] = useState<FocusDetail | null>(null);
  const [objectiveIds, setObjectiveIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [kind, setKind] = useState<PracticeKind>('FULL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listRequest = useRef<AbortController | null>(null);
  const focusRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const objectives = map?.nodes.filter((entry) => entry.node.kind === 'OBJECTIVE') ?? [];
  const future =
    ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].indexOf(course.viewedLevel) >
    ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].indexOf(course.currentLevel);

  const loadAnalyses = useCallback(
    async (cursor?: string) => {
      listRequest.current?.abort();
      const current = new AbortController();
      listRequest.current = current;
      if (!cursor) onVerifiedFocus?.(null);
      setError('');
      try {
        const response = await fetch(
          `/api/v1/courses/${encodeURIComponent(course.courseId)}/material-analyses${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`,
          { signal: current.signal, cache: 'no-store' }
        );
        const result = courseAnalysisListSchema.parse(await body(response));
        if (current.signal.aborted || listRequest.current !== current) return;
        if (result.courseId !== course.courseId)
          throw new Error('The source library belongs to another course.');
        setAnalyses((previous) =>
          cursor && previous ? { ...result, items: [...previous.items, ...result.items] } : result
        );
      } catch (cause) {
        if (!current.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not load the source library.');
      } finally {
        if (listRequest.current === current) listRequest.current = null;
      }
    },
    [course.courseId, onVerifiedFocus]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAnalyses(), 0);
    return () => {
      window.clearTimeout(timer);
      listRequest.current?.abort();
      focusRequest.current?.abort();
      detailRequest.current?.abort();
      actionRequest.current?.abort();
      onVerifiedFocus?.(null);
    };
  }, [loadAnalyses, onVerifiedFocus]);

  async function loadFocuses(analysisId: string, cursor?: string) {
    onVerifiedFocus?.(null);
    focusRequest.current?.abort();
    const previousDetail = detailRequest.current;
    detailRequest.current = null;
    previousDetail?.abort();
    const previousAction = actionRequest.current;
    actionRequest.current = null;
    previousAction?.abort();
    const current = new AbortController();
    focusRequest.current = current;
    setSelectedAnalysisId(analysisId);
    setSelectedFocus(null);
    setDetail(null);
    setPreview(null);
    setObjectiveIds([]);
    if (!cursor) setProjection(null);
    setError('');
    setBusy(true);
    try {
      const response = await fetch(
        `/api/v1/material-analyses/${analysisId}${cursor ? `?afterOrder=${encodeURIComponent(cursor)}` : ''}`,
        { signal: current.signal, cache: 'no-store' }
      );
      const result = projectionSchema.parse(await body(response));
      if (current.signal.aborted || focusRequest.current !== current) return;
      if (result.analysisId !== analysisId) throw new Error('The saved source analysis changed.');
      setProjection((previous) =>
        cursor && previous?.analysisId === analysisId
          ? { ...result, focuses: [...previous.focuses, ...result.focuses] }
          : result
      );
    } catch (cause) {
      if (!current.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Could not load source classes.');
    } finally {
      if (focusRequest.current === current) {
        focusRequest.current = null;
        setBusy(false);
      }
    }
  }

  async function loadDetail(focus: Focus) {
    if (!projection) return;
    onVerifiedFocus?.(null);
    detailRequest.current?.abort();
    const previousAction = actionRequest.current;
    actionRequest.current = null;
    previousAction?.abort();
    const current = new AbortController();
    detailRequest.current = current;
    setSelectedFocus(focus);
    setDetail(null);
    setPreview(null);
    setObjectiveIds([]);
    setError('');
    setBusy(true);
    try {
      const response = await fetch(
        `/api/v1/material-analyses/${projection.analysisId}/focuses/${focus.id}`,
        { signal: current.signal, cache: 'no-store' }
      );
      const result = sourceFocusDetailSchema.parse(await body(response));
      if (current.signal.aborted || detailRequest.current !== current) return;
      if (
        result.analysisId !== projection.analysisId ||
        result.analysisRevision !== projection.analysisRevision ||
        result.resultDigest !== projection.resultDigest ||
        result.focusDigest !== focus.focusDigest
      )
        throw new Error('This source class changed. Reload its saved analysis.');
      setDetail(result);
      onVerifiedFocus?.({
        courseId: course.courseId,
        level: course.viewedLevel,
        analysisId: result.analysisId,
        analysisRevision: result.analysisRevision,
        resultDigest: result.resultDigest,
        focusId: focus.id,
        focusDigest: result.focusDigest,
        title: result.focus.title,
        objectiveIds: sourceObjectiveIds(map, result.focus.objectiveCandidates),
      });
    } catch (cause) {
      if (!current.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Could not inspect this source class.');
    } finally {
      if (detailRequest.current === current) {
        detailRequest.current = null;
        setBusy(false);
      }
    }
  }

  async function previewClass() {
    if (!selectedFocus || !detail || busy || future) return;
    actionRequest.current?.abort();
    const current = new AbortController();
    actionRequest.current = current;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const response = await fetch(
        `/api/v1/courses/${encodeURIComponent(course.courseId)}/learning-map/selection`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: current.signal,
          body: JSON.stringify({
            catalogVersion: map?.catalogVersion ?? null,
            level: course.viewedLevel,
            nodeIds: objectiveIds,
            materialFocusId: selectedFocus.id,
          }),
        }
      );
      const result = learningSelectionPreviewSchema.parse(await body(response));
      if (current.signal.aborted || actionRequest.current !== current) return;
      if (
        result.selection.materialFocusId !== selectedFocus.id ||
        result.selection.level !== course.viewedLevel ||
        result.selection.targetLang !== course.targetLang ||
        result.selection.catalogHash !== (map?.catalogHash ?? null) ||
        (!map &&
          (result.selection.catalogVersion !== null || result.selection.objectives.length > 0))
      )
        throw new Error('The class preview no longer matches the selected source and level.');
      setPreview(result);
      setKind(result.availableKinds[0]);
    } catch (cause) {
      if (!current.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Could not preview this practice class.');
    } finally {
      if (actionRequest.current === current) {
        actionRequest.current = null;
        setBusy(false);
      }
    }
  }

  async function generate() {
    if (!preview || !selectedFocus || busy || future) return;
    setBusy(true);
    setError('');
    try {
      await onPractice(
        {
          catalogVersion: preview.selection.catalogVersion,
          level: preview.selection.level,
          nodeIds: preview.selection.objectives.map((objective) => objective.id),
          materialFocusId: selectedFocus.id,
        },
        kind
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start practice.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.root} aria-label="Classes from your materials">
      <header>
        <p className={styles.eyebrow}>Your materials</p>
        <h2>Classes worth revisiting</h2>
        <p>These are teaching focuses found in your sources. Practice results establish mastery.</p>
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button
        type="button"
        className={styles.secondary}
        disabled={busy}
        onClick={() => void loadAnalyses()}
      >
        Refresh source library
      </button>
      {!analyses && !error && <p role="status">Loading saved source analyses.</p>}
      {analyses?.items.length === 0 && (
        <p>
          Upload materials in Course notes, then analyze their teaching focuses to build this
          library.
        </p>
      )}
      {analyses && (
        <>
          <ul className={styles.analyses}>
            {analyses.items.map((analysis) => (
              <li key={analysis.analysisId}>
                <button
                  type="button"
                  className={styles.analysis}
                  aria-pressed={selectedAnalysisId === analysis.analysisId}
                  disabled={busy}
                  onClick={() => void loadFocuses(analysis.analysisId)}
                >
                  <strong>{analysis.sourceNames.join(', ')}</strong>
                  <span>
                    {analysis.focusCount} source classes ·{' '}
                    {analysis.status.toLowerCase().replaceAll('_', ' ')}
                  </span>
                  {analysis.retryOfAnalysisId && <small>Saved retry</small>}
                </button>
              </li>
            ))}
          </ul>
          {analyses.nextCursor && (
            <button
              className={styles.secondary}
              disabled={busy}
              type="button"
              onClick={() => void loadAnalyses(analyses.nextCursor ?? undefined)}
            >
              More saved analyses
            </button>
          )}
        </>
      )}
      {projection && (
        <div className={styles.analysisBody}>
          <MaterialCoverage analysis={projection} />
          {projection.stale && (
            <p role="status">
              A source changed. Analyze its current revision before generating another class.
            </p>
          )}
          <MaterialAnalysisRetry analysis={projection} onRetry={(child) => loadFocuses(child)} />
          <ul className={styles.focusList}>
            {projection.focuses.map((focus) => (
              <li key={focus.id}>
                <button
                  className={styles.focus}
                  type="button"
                  disabled={busy}
                  aria-pressed={selectedFocus?.id === focus.id}
                  onClick={() => void loadDetail(focus)}
                >
                  <strong>{focus.title}</strong>
                  <span>
                    {focus.kind.toLowerCase()} · {focus.level ?? 'Difficulty unresolved'} · Source
                    exposure
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {projection.nextCursor && (
            <button
              className={styles.secondary}
              type="button"
              disabled={busy}
              onClick={() =>
                void loadFocuses(projection.analysisId, projection.nextCursor ?? undefined)
              }
            >
              More source classes
            </button>
          )}
        </div>
      )}
      {selectedFocus && !detail && busy && (
        <p role="status">Checking this source class and its citations.</p>
      )}
      {detail && selectedFocus && (
        <article className={styles.detail}>
          <h3>{detail.focus.title}</h3>
          {map && (
            <SourceObjectiveLinks
              map={map}
              objectiveIds={sourceObjectiveIds(map, detail.focus.objectiveCandidates)}
            />
          )}
          {detail.focus.fragments.map((fragment) => (
            <p key={fragment.id}>{fragment.candidate.description}</p>
          ))}
          {detail.focus.privateExtension && (
            <p>
              This focus has no confirmed catalog equivalent. Private practice still provides
              feedback.
            </p>
          )}
          <details>
            <summary>Source evidence ({detail.focus.citations.length} excerpts)</summary>
            {detail.focus.citations.map((citation, index) => (
              <blockquote key={index}>
                <p>{citation.quote}</p>
                <footer>
                  {citation.sourceKind === 'PASTE'
                    ? 'Pasted text'
                    : citation.sourceKind === 'COURSE_NOTE'
                      ? 'Course note'
                      : citation.origin === 'SOURCE_TEXT'
                        ? 'Source text'
                        : `Page ${citation.pageNumber} · ${citation.origin.toLowerCase()}`}
                  {citation.sourceKind === 'MATERIAL' && citation.materialId && (
                    <>
                      {' '}
                      <a
                        className={discoveryStyles.objectiveLink}
                        href={`/api/v1/materials/${encodeURIComponent(citation.materialId)}/file?variant=original${citation.origin === 'SOURCE_TEXT' ? '' : `&disposition=inline#page=${citation.pageNumber}`}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {citation.origin === 'SOURCE_TEXT'
                          ? 'Download original'
                          : `Open original at page ${citation.pageNumber}`}
                      </a>
                    </>
                  )}
                </footer>
              </blockquote>
            ))}
          </details>
          {map ? (
            <fieldset disabled={busy || future} className={styles.objectives}>
              <legend>Include assessed objectives (optional, up to four)</legend>
              <p>
                Choose grammar, situations, or both. Leaving this empty generates private practice
                without awarding catalog mastery.
              </p>
              {objectives.map((entry) => (
                <label key={entry.node.id}>
                  <input
                    type="checkbox"
                    checked={objectiveIds.includes(entry.node.id)}
                    disabled={!objectiveIds.includes(entry.node.id) && objectiveIds.length >= 4}
                    onChange={() => {
                      setObjectiveIds((previous) =>
                        previous.includes(entry.node.id)
                          ? previous.filter((id) => id !== entry.node.id)
                          : [...previous, entry.node.id]
                      );
                      setPreview(null);
                    }}
                  />
                  <span>{entry.node.title}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p>
              No catalog is published for this language. Practice this private source focus without
              canonical objective credit.
            </p>
          )}
          <button
            className={styles.secondary}
            type="button"
            disabled={busy || future || projection?.stale}
            onClick={() => void previewClass()}
          >
            Preview practice at {course.viewedLevel}
          </button>
          {preview && (
            <div className={styles.preview}>
              <h4>Practice at {preview.selection.level}</h4>
              <p>
                {preview.selection.objectives.length
                  ? `Assesses: ${preview.selection.objectives.map((objective) => objective.title).join(', ')}`
                  : 'Private source practice. Catalog objectives stay unassessed.'}
              </p>
              <label>
                Practice format
                <select
                  value={kind}
                  disabled={busy}
                  onChange={(event) => setKind(event.target.value as PracticeKind)}
                >
                  {preview.availableKinds.map((format) => (
                    <option key={format} value={format}>
                      {format.toLowerCase().replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={styles.primary}
                disabled={busy || future || projection?.stale}
                type="button"
                onClick={() => void generate()}
              >
                Generate another practice class
              </button>
            </div>
          )}
        </article>
      )}
    </section>
  );
}
