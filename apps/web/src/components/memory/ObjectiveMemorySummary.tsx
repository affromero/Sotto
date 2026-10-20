import type { LearningObjectiveMemory } from '@sotto/shared';
import styles from './ObjectiveMemorySummary.module.css';

interface Props {
  courseId: string;
  objectives: readonly LearningObjectiveMemory[];
}

const labels = {
  NOT_ASSESSED: 'Not assessed',
  PRACTISING: 'Practising',
  CONFIDENT: 'Confident',
  NEEDS_WORK: 'Needs work',
} as const;

export function ObjectiveMemorySummary({ courseId, objectives }: Props) {
  const mapUrl = `/learn/map?${new URLSearchParams({ course: courseId })}`;
  const counts = Object.entries(labels).map(([status, label]) => ({
    status,
    label,
    count: objectives.filter((entry) => entry.progress.status === status).length,
  }));
  const due = objectives.filter((entry) => entry.progress.reviewDue).length;
  const highlights = [...objectives]
    .sort((left, right) => Number(right.progress.reviewDue) - Number(left.progress.reviewDue))
    .slice(0, 5);

  return (
    <section className={styles.root} aria-labelledby="objective-memory-heading">
      <h2 id="objective-memory-heading">Objective progress</h2>
      {objectives.length ? (
        <>
          <p>
            {objectives.length} objectives across your saved level requirements. Status reflects
            assessments against specific skill criteria. Open the learning map for your current
            level requirements.
          </p>
          <dl className={styles.counts}>
            {counts.map(({ status, label, count }) => (
              <div key={status}>
                <dt>{label}</dt>
                <dd>{count}</dd>
              </div>
            ))}
            <div>
              <dt>Review due</dt>
              <dd>{due}</dd>
            </div>
          </dl>
          <p>
            Confidence and review due are independent. A confident objective can still need review.
          </p>
          <ul className={styles.objectives} aria-label="Objectives to inspect">
            {highlights.map(({ objective, progress }) => (
              <li key={objective.id}>
                <a
                  href={`/learn/map?${new URLSearchParams({ course: courseId, level: objective.level, objective: objective.id })}`}
                >
                  <span>{objective.title}</span>
                  <span className={styles.detail}>
                    {objective.level}. {labels[progress.status]}
                    {progress.reviewDue ? '. Review due' : ''}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {objectives.length > highlights.length && (
            <p>
              Showing {highlights.length} of {objectives.length} saved objectives.
            </p>
          )}
        </>
      ) : (
        <p>Open the learning map to inspect your level requirements.</p>
      )}
      <a className={styles.mapLink} href={mapUrl}>
        Open learning map
      </a>
    </section>
  );
}
