import type { LearningMapResponse } from '@sotto/shared';
import { defaultMapView, writeMapView } from './state';
import styles from './MapFilters.module.css';

export function SourceObjectiveLinks({
  map,
  objectiveIds,
}: {
  map: LearningMapResponse;
  objectiveIds: string[];
}) {
  const ids = new Set(objectiveIds);
  const objectives = map.nodes.filter(({ node }) => node.kind === 'OBJECTIVE' && ids.has(node.id));
  if (!objectives.length) return null;
  return (
    <section aria-label="Mapped objectives in this level">
      <h4>Mapped objectives at {map.viewedLevel}</h4>
      <p>These source mappings describe exposure. Practice results establish mastery.</p>
      <ul>
        {objectives.map(({ node }) => (
          <li key={node.id}>
            <a
              className={styles.objectiveLink}
              href={
                writeMapView(
                  new URL('https://sotto.invalid/'),
                  { ...defaultMapView, objective: node.id },
                  map.courseId,
                  map.viewedLevel
                ).search
              }
            >
              {node.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
