import Link from 'next/link';
import { BookOpenCheck, Clock3, RotateCcw } from 'lucide-react';
import { WorkbookLink } from './WorkbookLink';
import styles from './CourseClassHistory.module.css';

type ClassStatus =
  | 'LOCKED'
  | 'GENERATING'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'PASSED'
  | 'FAILED';

export interface CourseClassHistoryItem {
  id: string;
  order: number;
  status: ClassStatus;
  attempt: number;
  sourceTitle: string | null;
  createdAt: Date | string;
  submittedAt: Date | string | null;
  passedAt: Date | string | null;
  failedAt: Date | string | null;
  lesson: {
    title: string;
    level: string;
  };
  submission: {
    overallScore: number | null;
    passed: boolean | null;
    submittedAt: Date | string;
  } | null;
}

interface CourseClassHistoryProps {
  classes: CourseClassHistoryItem[];
  courseTitle: string;
}

const STATUS_COPY: Record<ClassStatus, string> = {
  LOCKED: 'Locked',
  GENERATING: 'Building',
  AVAILABLE: 'Ready',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
  PASSED: 'Passed',
  FAILED: 'Retry',
};

function classDateLabel(cls: CourseClassHistoryItem): string {
  const raw = cls.passedAt ?? cls.failedAt ?? cls.submittedAt ?? cls.createdAt;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(raw));
}

function primaryActionLabel(status: ClassStatus): string {
  if (status === 'PASSED') return 'Review';
  if (status === 'FAILED') return 'Retry';
  if (status === 'AVAILABLE') return 'Start';
  return 'Resume';
}

function statusClass(status: ClassStatus): string {
  if (status === 'PASSED') return styles.statusPassed;
  if (status === 'FAILED') return styles.statusFailed;
  if (status === 'GENERATING' || status === 'LOCKED') return styles.statusMuted;
  return styles.statusActive;
}

function classTitle(cls: CourseClassHistoryItem): string {
  return cls.sourceTitle?.trim() || cls.lesson.title;
}

function scoreLabel(cls: CourseClassHistoryItem): string | null {
  if (!cls.submission || cls.submission.overallScore == null) return null;
  return `${Math.round(cls.submission.overallScore * 100)}%`;
}

export function CourseClassHistory({ classes, courseTitle }: CourseClassHistoryProps) {
  return (
    <section className={styles.root} aria-label={`${courseTitle} class history`}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>Class history</h3>
          <p className={styles.subtitle}>
            Open any class again on web, or use the workbook on iPad.
          </p>
        </div>
        {classes.length > 0 && (
          <span className={styles.count}>
            {classes.length} {classes.length === 1 ? 'class' : 'classes'}
          </span>
        )}
      </div>

      {classes.length === 0 ? (
        <p className={styles.empty}>Classes you start or complete will appear here.</p>
      ) : (
        <ol className={styles.list}>
          {classes.map((cls) => {
            const title = classTitle(cls);
            const score = scoreLabel(cls);
            const actionLabel = primaryActionLabel(cls.status);

            return (
              <li className={styles.item} key={cls.id}>
                <div className={styles.itemMain}>
                  <div className={styles.itemTopline}>
                    <span className={`${styles.status} ${statusClass(cls.status)}`}>
                      {STATUS_COPY[cls.status]}
                    </span>
                    <span className={styles.meta}>
                      Class {cls.order} · {cls.lesson.level} · {classDateLabel(cls)}
                    </span>
                  </div>
                  <h4 className={styles.itemTitle}>{title}</h4>
                  <div className={styles.itemFoot}>
                    {cls.sourceTitle ? (
                      <span className={styles.kind}>Source class</span>
                    ) : (
                      <span className={styles.kind}>Course class</span>
                    )}
                    {cls.attempt > 1 && (
                      <span className={styles.kind}>
                        <RotateCcw size={13} aria-hidden="true" /> attempt {cls.attempt}
                      </span>
                    )}
                    {score && (
                      <span className={styles.kind}>
                        <Clock3 size={13} aria-hidden="true" /> {score}
                      </span>
                    )}
                  </div>
                </div>

                <div className={styles.actions} aria-label={`${title} actions`}>
                  <Link
                    className={`${styles.action} ${styles.primary}`}
                    href={`/learn/class/${cls.id}`}
                  >
                    <BookOpenCheck size={16} aria-hidden="true" />
                    {actionLabel}
                  </Link>
                  <WorkbookLink
                    className={styles.action}
                    classTitle={title}
                    href={`/classes/${cls.id}/worksheet`}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
