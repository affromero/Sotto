import Link from 'next/link';
import { ClassGlyph } from '../ClassGlyph';
import type { ClassData } from '../classTypes';
import styles from './ClassNavigation.module.css';

interface ClassNavigationProps {
  classInfo?: Pick<ClassData, 'order' | 'lesson'>;
  currentSection: string;
  onOverview?: () => void;
  busy?: boolean;
}

export function ClassNavigation({
  classInfo,
  currentSection,
  onOverview,
  busy = false,
}: ClassNavigationProps) {
  return (
    <header className={styles.root} aria-label="Class header">
      <Link className={styles.brand} href="/learn" aria-label="Sotto home">
        <span aria-hidden="true" />
        sotto
      </Link>
      <div className={styles.context}>
        <nav aria-label="Class location">
          <ol className={styles.location}>
            {classInfo && (
              <li>
                Class {classInfo.order} · {classInfo.lesson.level}
              </li>
            )}
            <li aria-current="page">{currentSection}</li>
          </ol>
        </nav>
        <p className={styles.title}>{classInfo?.lesson.title ?? 'Your class'}</p>
      </div>
      <div className={styles.actions}>
        <Link className={styles.back} href="/learn">
          <ClassGlyph name="back" size={17} />
          Back to Learn
        </Link>
        {onOverview && (
          <button type="button" className={styles.overview} onClick={onOverview} disabled={busy}>
            Lesson overview
          </button>
        )}
      </div>
    </header>
  );
}
