import type { CefrLevel, LearningMapResponse } from '@sotto/shared';
import styles from './MapFilters.module.css';

/** A verified, owned source detail receipt. Exposure never changes assessment state. */
export interface SourceExposureScope {
  courseId: string;
  level: CefrLevel;
  analysisId: string;
  analysisRevision: number;
  resultDigest: string;
  focusId: string;
  focusDigest: string;
  title: string;
  objectiveIds: string[];
}

export function sourceExposureKey(scope: SourceExposureScope) {
  return `${scope.courseId}:${scope.level}:${scope.analysisId}:${scope.analysisRevision}:${scope.resultDigest}:${scope.focusId}:${scope.focusDigest}`;
}

export function sourceObjectiveIds(
  map: LearningMapResponse | undefined,
  candidates: readonly { objectiveId: string; criterionVersion: number; level: CefrLevel }[]
) {
  if (!map) return [];
  return [
    ...new Set(
      candidates
        .filter((candidate) =>
          map.nodes.some(
            ({ node }) =>
              node.kind === 'OBJECTIVE' &&
              node.id === candidate.objectiveId &&
              node.level === map.viewedLevel &&
              node.level === candidate.level &&
              node.criterionVersion === candidate.criterionVersion
          )
        )
        .map((candidate) => candidate.objectiveId)
    ),
  ];
}

export function SourceExposure({
  scope,
  mappedCount,
  onlyMapped,
  onOnlyMapped,
  onClear,
  disabled,
}: {
  scope: SourceExposureScope;
  mappedCount: number;
  onlyMapped: boolean;
  onOnlyMapped: (value: boolean) => void;
  onClear?: () => void;
  disabled: boolean;
}) {
  return (
    <section className={styles.source} aria-label="Selected source exposure">
      <p>
        Selected source class: <strong>{scope.title}</strong>
      </p>
      <p>
        {mappedCount > 0
          ? `${mappedCount} exact objective ${mappedCount === 1 ? 'mapping' : 'mappings'} in ${scope.level}.`
          : `No exact objective mappings in ${scope.level}. This source class remains available for private practice.`}{' '}
        Source exposure leaves mastery and level readiness unchanged.
      </p>
      <div className={styles.sourceControls}>
        {mappedCount > 0 && (
          <label>
            <input
              type="checkbox"
              checked={onlyMapped}
              disabled={disabled}
              onChange={(event) => onOnlyMapped(event.target.checked)}
            />
            Only objectives seen in this source class
          </label>
        )}
        {onClear && (
          <button type="button" disabled={disabled} onClick={onClear}>
            Clear source overlay
          </button>
        )}
      </div>
    </section>
  );
}
