import type { MaterialAnalysisProjection } from '@/lib/course-materials/client/analysis';
import styles from './MaterialCoverage.module.css';

export function MaterialPartialConsent({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.consent}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      I reviewed the unresolved source coverage and accept this partial estimate.
    </label>
  );
}

export function MaterialCoverage({ analysis }: { analysis: MaterialAnalysisProjection }) {
  const coverage = analysis.coverage;
  if (!coverage)
    return (
      <p className={styles.root} role="status">
        Refresh to see the source coverage report.
      </p>
    );
  const sourceIds = [...new Set(coverage.unresolvedPages.map((page) => page.sourceId))];
  return (
    <section className={styles.root} aria-label="Source coverage">
      {analysis.counts && (
        <p>
          {analysis.counts.inherited} successful{' '}
          {analysis.counts.inherited === 1 ? 'chunk' : 'chunks'} reused, including{' '}
          {analysis.counts.offlineReplay} saved responses for offline analysis.{' '}
          {analysis.counts.failed} failed chunks were eligible for a new request.
        </p>
      )}
      <p>
        {coverage.analyzedChunks} of {coverage.expectedChunks} text chunks analyzed.{' '}
        {coverage.analyzedCodePoints.toLocaleString()} of{' '}
        {coverage.expectedCodePoints.toLocaleString()} source characters covered.
      </p>
      {coverage.failedUnitIds.length > 0 && (
        <p>{coverage.failedUnitIds.length} chunks could not be analyzed.</p>
      )}
      {coverage.pendingUnitIds.length > 0 && (
        <p>{coverage.pendingUnitIds.length} chunks are still pending.</p>
      )}
      {coverage.unresolvedPages.length > 0 && (
        <details>
          <summary>{coverage.unresolvedPages.length} unresolved page entries</summary>
          <ul>
            {coverage.unresolvedPages.map((page, index) => (
              <li key={`${page.sourceId}:${page.pageNumber}:${index}`}>
                {analysis.sources?.find(
                  (source) =>
                    source.sourceId === page.sourceId || source.materialId === page.sourceId
                )?.name ?? `Source ${sourceIds.indexOf(page.sourceId) + 1}`}
                , page {page.pageNumber}: {page.state.toLowerCase().replaceAll('_', ' ')}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!coverage.originalContentComplete && (
        <p>
          The estimate uses available readable text. Unresolved visual content and failed chunks
          remain unassessed.
        </p>
      )}
    </section>
  );
}
