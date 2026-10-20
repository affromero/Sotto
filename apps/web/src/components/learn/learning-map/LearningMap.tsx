'use client';

import { useId, useState } from 'react';
import {
  LANGUAGE_DISPLAY,
  learningLevels,
  type CefrLevel,
  type LearningMapResponse,
  type LearningSelectionRequest,
  type ObjectiveStatus,
  type PracticeKind,
} from '@sotto/shared';
import styles from './LearningMap.module.css';
import { ObjectiveHistory } from './ObjectiveHistory';
import { MapFilters } from './discovery/MapFilters';
import { defaultMapView, filterMap, writeMapView, type MapViewState } from './discovery/state';
import discoveryStyles from './discovery/MapFilters.module.css';
import {
  SourceExposure,
  sourceExposureKey,
  type SourceExposureScope,
} from './discovery/SourceExposure';

export interface LearningMapProps {
  map: LearningMapResponse;
  onViewLevel: (level: CefrLevel) => void;
  onPractice: (selection: LearningSelectionRequest, kind: PracticeKind) => Promise<void>;
  onAdvance: () => Promise<void>;
  busy: boolean;
  error: string | null;
  viewState?: MapViewState;
  onViewStateChange?: (view: MapViewState) => void;
  sourceExposure?: SourceExposureScope | null;
  onClearSourceExposure?: () => void;
}

type NodeView = LearningMapResponse['nodes'][number];
const statusLabels: Record<ObjectiveStatus, string> = {
  NOT_ASSESSED: 'Not assessed',
  PRACTISING: 'Practising',
  CONFIDENT: 'Confident',
  NEEDS_WORK: 'Needs work',
};
const formatLabels: Record<PracticeKind, string> = {
  FULL: 'Full practice class',
  GRAMMAR: 'Grammar',
  READING: 'Reading',
  LISTENING: 'Listening',
  SPEAKING: 'Speaking',
  WRITING: 'Writing',
  VOCAB: 'Vocabulary',
};

/** Reset local selections when the parent loads a different course, band, or catalog. */
export function LearningMap(props: LearningMapProps) {
  return (
    <LearningMapView
      key={`${props.map.courseId}:${props.map.viewedLevel}:${props.map.catalogHash}`}
      {...props}
    />
  );
}

function LearningMapView({
  map,
  onViewLevel,
  onPractice,
  onAdvance,
  busy,
  error,
  viewState,
  onViewStateChange,
  sourceExposure,
  onClearSourceExposure,
}: LearningMapProps) {
  const id = useId();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [format, setFormat] = useState<PracticeKind>('FULL');
  const [pending, setPending] = useState<'practice' | 'advance' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sourceOnlyKey, setSourceOnlyKey] = useState<string | null>(null);
  const [localView, setLocalView] = useState<MapViewState>({
    ...defaultMapView,
  });
  const view = viewState ?? localView;
  const changeView = (next: MapViewState) => {
    if (onViewStateChange) onViewStateChange(next);
    else setLocalView(next);
  };
  const sourceScope =
    sourceExposure?.courseId === map.courseId && sourceExposure.level === map.viewedLevel
      ? sourceExposure
      : null;
  const sourceKey = sourceScope ? sourceExposureKey(sourceScope) : null;
  const sourceIds = new Set(
    sourceScope
      ? map.nodes
          .filter(
            ({ node }) => node.kind === 'OBJECTIVE' && sourceScope.objectiveIds.includes(node.id)
          )
          .map(({ node }) => node.id)
      : []
  );
  const onlySource = sourceKey !== null && sourceOnlyKey === sourceKey;
  const discovery = filterMap(map, view, onlySource ? sourceIds : undefined);
  const working = busy || pending !== null;
  const shownError = error ?? actionError;
  const objectives = map.nodes.filter((item) => item.node.kind === 'OBJECTIVE');
  const selected = objectives.filter((item) => selectedIds.includes(item.node.id));
  const hiddenSelectedCount = selected.filter(
    (item) => !discovery.visible.has(item.node.id)
  ).length;
  const availableFormats: PracticeKind[] = [
    'FULL',
    ...(['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING'] as const).filter(
      (skill) =>
        selected.length > 0 &&
        !(
          (skill === 'LISTENING' || skill === 'SPEAKING') &&
          map.readiness.exemptSkills.includes(skill)
        ) &&
        selected.every((item) => item.node.kind === 'OBJECTIVE' && item.node.skills.includes(skill))
    ),
  ];
  const chosenFormat = availableFormats.includes(format) ? format : 'FULL';
  const currentView = map.viewedLevel === map.currentLevel;
  const lowerView =
    learningLevels.indexOf(map.viewedLevel) < learningLevels.indexOf(map.currentLevel);
  const futureView = !currentView && !lowerView;
  const completedC2 = map.viewedLevel === 'C2' && map.completedAt !== null;
  const canAdvance =
    currentView && map.readiness.ready && map.blockers.length === 0 && !completedC2;
  const byId = new Map(map.nodes.map((item) => [item.node.id, item]));
  const children = new Map<string | null, NodeView[]>();
  for (const item of map.nodes) {
    const siblings = children.get(item.node.parentId) ?? [];
    siblings.push(item);
    children.set(item.node.parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.node.order - b.node.order);

  function toggleObjective(objectiveId: string) {
    if (futureView || working) return;
    setSelectedIds((previous) =>
      previous.includes(objectiveId)
        ? previous.filter((value) => value !== objectiveId)
        : previous.length < 4
          ? [...previous, objectiveId]
          : previous
    );
  }

  async function runAction(action: 'practice' | 'advance') {
    if (working || (action === 'practice' && (futureView || selected.length === 0))) return;
    setActionError(null);
    setPending(action);
    try {
      if (action === 'advance') {
        if (!canAdvance) return;
        await onAdvance();
      } else {
        await onPractice(
          {
            catalogVersion: map.catalogVersion,
            level: map.viewedLevel,
            nodeIds: selected.map((item) => item.node.id).sort(),
          },
          chosenFormat
        );
      }
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : 'The request failed. Try again.');
    } finally {
      setPending(null);
    }
  }

  function renderNode(item: NodeView) {
    const { node, progress, summary } = item;
    if (!discovery.visible.has(node.id)) return null;
    const isRoot = node.parentId === null;
    return (
      <li key={node.id} className={styles.treeItem}>
        <details
          className={styles.disclosure}
          open={isRoot || discovery.active || discovery.objectivePath.has(node.id) || undefined}
          data-root={isRoot}
          data-objective-id={node.kind === 'OBJECTIVE' ? node.id : undefined}
        >
          <summary className={styles.summary}>
            <span className={isRoot ? styles.branchTitle : styles.nodeTitle}>{node.title}</span>
            {node.kind === 'GROUP' ? (
              <span className={styles.nodeMeta}>
                {discovery.counts.get(node.id) ?? 0} of {summary.total} objectives shown · Whole
                group: {summary.confident} of {summary.total} confident
                {summary.reviewDue > 0 ? ` · ${summary.reviewDue} due` : ''}
              </span>
            ) : (
              <span className={styles.badges}>
                <span className={styles.badge}>{node.required ? 'Required' : 'Optional'}</span>
                <span className={styles.badge}>
                  {progress ? statusLabels[progress.status] : 'Evidence unavailable'}
                </span>
                {progress?.reviewDue && <span className={styles.due}>Review due</span>}
                {sourceIds.has(node.id) && (
                  <span className={styles.badge}>Seen in selected source class</span>
                )}
              </span>
            )}
          </summary>
          {node.kind === 'GROUP' ? (
            <>
              <button
                type="button"
                className={styles.secondary}
                disabled={working || futureView}
                onClick={() => {
                  if (working || futureView) return;
                  setPending('practice');
                  setActionError(null);
                  void onPractice(
                    {
                      catalogVersion: map.catalogVersion,
                      level: map.viewedLevel,
                      nodeIds: [node.id],
                    },
                    'FULL'
                  )
                    .catch((failure: unknown) =>
                      setActionError(
                        failure instanceof Error
                          ? failure.message
                          : 'Could not prepare group practice.'
                      )
                    )
                    .finally(() => setPending(null));
                }}
              >
                Practice {node.title} at {map.viewedLevel}
              </button>
              <ul className={styles.children}>{(children.get(node.id) ?? []).map(renderNode)}</ul>
            </>
          ) : (
            <div className={styles.objectiveDetail}>
              <a
                className={discoveryStyles.objectiveLink}
                href={
                  writeMapView(
                    new URL('https://sotto.invalid/'),
                    { ...defaultMapView, objective: node.id },
                    map.courseId,
                    map.viewedLevel
                  ).search
                }
                onClick={(event) => {
                  event.preventDefault();
                  changeView({ ...defaultMapView, objective: node.id });
                }}
              >
                Link to {node.title}
              </a>
              <p className={styles.criterion}>{node.assessment}</p>
              <div className={styles.examples}>
                <h3>Examples</h3>
                <ul>
                  {node.examples.map((example, index) => (
                    <li key={`${index}:${example}`} lang={map.targetLang}>
                      {example}
                    </li>
                  ))}
                </ul>
              </div>
              {progress && (
                <div className={styles.skillBreakdown}>
                  <h3>Evidence by skill</h3>
                  <ul className={styles.skillList}>
                    {progress.skills.map((skill) => (
                      <li key={skill.skill}>
                        <span className={styles.skillName}>{formatLabels[skill.skill]}</span>
                        <p>{node.skillCriteria[skill.skill]}</p>
                        <span>
                          {skill.exempt ? 'Exempt, unassessed' : statusLabels[skill.status]}
                        </span>
                        {skill.evidence && (
                          <span className={styles.evidenceDetail}>
                            {skill.evidence.assessedTasks} assessed tasks across{' '}
                            {skill.evidence.assessedSessions} sessions
                            {skill.evidence.lastQuality !== null &&
                              ` · Last observed score ${Math.round(skill.evidence.lastQuality * 100)}%`}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <label className={styles.selectionLabel}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(node.id)}
                  disabled={
                    working ||
                    futureView ||
                    (!selectedIds.includes(node.id) && selectedIds.length >= 4)
                  }
                  onChange={() => toggleObjective(node.id)}
                />
                <span>Select {node.title} for practice</span>
              </label>
              <ObjectiveHistory
                courseId={map.courseId}
                objectiveId={node.id}
                level={map.viewedLevel}
              />
            </div>
          )}
        </details>
      </li>
    );
  }

  return (
    <section className={styles.root} aria-labelledby={`${id}-title`} aria-busy={working}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{LANGUAGE_DISPLAY[map.targetLang] ?? map.targetLang}</p>
          <h1 id={`${id}-title`}>Learning map</h1>
          <p className={styles.levelContext}>
            Current level: <strong>{map.currentLevel}</strong>
          </p>
        </div>
        <label className={styles.levelField}>
          Viewing level
          <select
            value={map.viewedLevel}
            disabled={working}
            onChange={(event) => onViewLevel(event.target.value as CefrLevel)}
          >
            {learningLevels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className={styles.feedback}>
        <p role="status" aria-live="polite" className={styles.statusMessage}>
          {working ? 'Saving your request. Please wait.' : ''}
        </p>
        {shownError && (
          <p role="alert" className={styles.error}>
            {shownError}
          </p>
        )}
      </div>

      {!currentView && (
        <p className={styles.viewNotice}>
          {lowerView
            ? `Reviewing ${map.viewedLevel}. Your current level stays ${map.currentLevel}.`
            : `Previewing ${map.viewedLevel}. Your current level is ${map.currentLevel}.`}
        </p>
      )}
      {futureView && (
        <p className={styles.viewNotice}>Reach this level to practise its objectives.</p>
      )}

      <section className={styles.requirements} aria-labelledby={`${id}-requirements`}>
        <div className={styles.requirementsHeader}>
          <div>
            <p className={styles.eyebrow}>Level requirements</p>
            <h2 id={`${id}-requirements`}>
              {completedC2 ? 'C2 complete. Keep practising.' : `${map.viewedLevel} requirements`}
            </h2>
          </div>
          <p className={styles.requirementCount}>
            <strong>{map.readiness.confidentCount}</strong> of {map.readiness.requiredCount}{' '}
            required objectives confident
          </p>
        </div>
        <p className={styles.requirementStates}>
          {map.readiness.unassessedCount} not assessed · {map.readiness.practisingCount} practising
          · {map.readiness.needsWorkCount} need work
        </p>
        {map.readiness.exemptSkills.length > 0 && (
          <p className={styles.coverage}>
            Exempt from this level&apos;s requirements:{' '}
            {map.readiness.exemptSkills.map((skill) => formatLabels[skill]).join(', ')}. These
            skills remain unassessed.
          </p>
        )}
        {map.readiness.missingObjectiveIds.length > 0 && (
          <details className={styles.remaining}>
            <summary>What remains for {map.viewedLevel}</summary>
            <ul>
              {map.readiness.missingObjectiveIds.map((objectiveId) => (
                <li key={objectiveId}>{byId.get(objectiveId)?.node.title ?? objectiveId}</li>
              ))}
            </ul>
          </details>
        )}
        {currentView && map.blockers.length > 0 && (
          <ul className={styles.blockers} aria-label="Before advancing">
            {map.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        )}
        {completedC2 && (
          <p>Your completion is recorded. Review due and further practice remain available.</p>
        )}
        {canAdvance && (
          <button
            type="button"
            className={styles.primary}
            disabled={working}
            onClick={() => void runAction('advance')}
          >
            {map.readiness.nextLevel ? `Advance to ${map.readiness.nextLevel}` : 'Complete C2'}
          </button>
        )}
        {currentView && !map.readiness.ready && !completedC2 && (
          <p className={styles.gateExplanation}>
            {map.readiness.nextLevel
              ? `${map.readiness.nextLevel} is locked until the remaining required objectives are confident.`
              : 'Complete the remaining required objectives to finish C2.'}
          </p>
        )}
      </section>

      {sourceScope && (
        <SourceExposure
          scope={sourceScope}
          mappedCount={sourceIds.size}
          onlyMapped={onlySource}
          onOnlyMapped={(enabled) => setSourceOnlyKey(enabled ? sourceKey : null)}
          onClear={
            onClearSourceExposure
              ? () => {
                  setSourceOnlyKey(null);
                  onClearSourceExposure();
                }
              : undefined
          }
          disabled={working}
        />
      )}
      <MapFilters
        value={view}
        onChange={changeView}
        disabled={working}
        count={discovery.matches.length}
        total={objectives.length}
      />
      {view.objective && !discovery.linked && (
        <p role="status">This objective is unavailable in the viewed level.</p>
      )}
      {discovery.linked && !discovery.visible.has(view.objective) && (
        <p>
          The linked objective is hidden by these filters.{' '}
          <button
            type="button"
            className={styles.secondary}
            disabled={working}
            onClick={() => changeView({ ...defaultMapView, objective: view.objective })}
          >
            Show linked objective
          </button>
        </p>
      )}
      <div className={styles.workspace}>
        <div className={styles.tree}>
          <p className={styles.treeHint}>
            Choose Grammar, Situations, or a combination. Open an objective to see its criteria and
            examples.
          </p>
          <ul className={styles.treeList} aria-label="Learning objectives">
            {(children.get(null) ?? []).map(renderNode)}
          </ul>
          {discovery.matches.length === 0 && <p>No objectives match these filters.</p>}
        </div>
        <section className={styles.practice} aria-labelledby={`${id}-practice`}>
          <p className={styles.eyebrow}>Repeatable practice</p>
          <h2 id={`${id}-practice`}>Practise {map.viewedLevel}</h2>
          <p>Choose up to four objectives. You can practise a confident objective again.</p>
          {hiddenSelectedCount > 0 && (
            <p>
              {hiddenSelectedCount} selected{' '}
              {hiddenSelectedCount === 1 ? 'objective is' : 'objectives are'} hidden by filters. The
              selection below stays the same.
            </p>
          )}
          {selected.length > 0 ? (
            <ul className={styles.selectedList} aria-label="Selected objectives">
              {selected.map((item) => (
                <li key={item.node.id}>{item.node.title}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptySelection}>Select one objective to begin.</p>
          )}
          <label className={styles.formatField}>
            Practice format
            <select
              value={chosenFormat}
              disabled={working || futureView || selected.length === 0}
              onChange={(event) => setFormat(event.target.value as PracticeKind)}
            >
              {availableFormats.map((kind) => (
                <option key={kind} value={kind}>
                  {formatLabels[kind]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.primary}
            disabled={working || futureView || selected.length === 0}
            onClick={() => void runAction('practice')}
          >
            Generate {map.viewedLevel} practice
          </button>
          {selected.length > 0 && (
            <button
              type="button"
              className={styles.secondary}
              disabled={working}
              onClick={() => setSelectedIds([])}
            >
              Clear selection
            </button>
          )}
        </section>
      </div>

      <details className={styles.sources}>
        <summary>Sources and curriculum references</summary>
        <p>
          These references describe the catalog. Uploaded materials and assessment evidence are
          separate.
        </p>
        <ul>
          {map.references.map((reference) => (
            <li key={reference.url}>
              <a href={reference.url} target="_blank" rel="noreferrer">
                {reference.title}
                <span className={styles.srOnly}> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
