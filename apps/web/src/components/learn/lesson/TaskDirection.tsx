import type { ClassPrerequisiteDirections } from './prerequisiteTypes';
import styles from './TaskDirection.module.css';

export function taskDirection(
  value: ClassPrerequisiteDirections | null | undefined,
  sectionId: string,
  taskId: string,
  kind: 'question' | 'speaking' | 'writing'
) {
  return value?.directions.tasks.find(
    (item) => item.sectionId === sectionId && item.taskId === taskId && item.kind === kind
  );
}

export function TaskDirection({
  id,
  text,
  language,
}: {
  id: string;
  text: string;
  language: string;
}) {
  return (
    <p id={id} className={styles.direction} lang={language}>
      {text}
    </p>
  );
}
