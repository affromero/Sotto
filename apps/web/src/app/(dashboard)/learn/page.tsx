import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { CourseClassHistory } from '@/components/learn/CourseClassHistory';
import { StartNextClass } from '@/components/learn/StartNextClass';
import { SourcedClassEntry } from '@/components/learn/SourcedClassEntry';
import { CefrDisclaimer } from '@/components/learn/CefrDisclaimer';
import { PedagogySelector } from '@/components/learn/PedagogySelector';
import { CourseNotesPanel } from '@/components/learn/CourseNotesPanel';
import { langLabel } from '@/lib/languages';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Learn' };

const LEVEL_LABELS: Record<string, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper-Intermediate',
  C1: 'Advanced',
  C2: 'Mastery',
};

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function levelLabel(level: string): string {
  return LEVEL_LABELS[level] ?? level;
}

/** Fraction (0..1) of the CEFR ladder this level represents, for the strip fill. */
function levelFraction(level: string): number {
  const i = CEFR_ORDER.indexOf(level);
  if (i < 0) return 0;
  return (i + 1) / CEFR_ORDER.length;
}

function isAtOrAboveCurrentLevel(classLevel: string, currentLevel: string): boolean {
  return CEFR_ORDER.indexOf(classLevel) >= CEFR_ORDER.indexOf(currentLevel);
}

export default async function LearnPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const courses = await prisma.course.findMany({
    where: { userId },
    select: {
      id: true,
      nativeLang: true,
      targetLang: true,
      currentLevel: true,
      placementSource: true,
      activeClassId: true,
      pedagogy: true,
      curriculum: { select: { title: true } },
      classes: {
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          order: true,
          status: true,
          attempt: true,
          sourceTitle: true,
          createdAt: true,
          submittedAt: true,
          passedAt: true,
          failedAt: true,
          lesson: { select: { title: true, level: true } },
          submission: { select: { overallScore: true, passed: true, submittedAt: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <div className={styles.eyebrow}>Your courses</div>
        <h1 className={styles.title}>
          Pick up <em>where you left off</em>.
        </h1>
        <p className={styles.subtitle}>
          Each course moves through classes gated by mastery. Resume the next class, or sharpen a
          single skill in ungated practice.
        </p>
        <CefrDisclaimer />
      </header>

      {courses.length === 0 ? (
        <section className={styles.empty}>
          <span className={styles.emptyIco} aria-hidden="true">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 5a2 2 0 012-2h6v16H6a2 2 0 00-2 2V5zM20 5a2 2 0 00-2-2h-6v16h6a2 2 0 012 2V5z" />
            </svg>
          </span>
          <p className={styles.emptyText}>
            No active courses yet. Take a quick placement test and we&rsquo;ll start you at the
            right level.
          </p>
          <Link href="/learn/placement" className={styles.ctaButton}>
            Take placement test
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </section>
      ) : (
        <ul className={styles.courseList} role="list">
          {courses.map((course) => {
            const pct = Math.round(levelFraction(course.currentLevel) * 100);
            const isManualPlacement = course.placementSource === 'MANUAL';
            const courseTitle = course.curriculum?.title ?? langLabel(course.targetLang);
            const placementHref = `/learn/placement?native=${course.nativeLang}&target=${course.targetLang}`;
            const activeClass = course.activeClassId
              ? course.classes.find((cls) => cls.id === course.activeClassId)
              : null;
            const activeClassId =
              activeClass && isAtOrAboveCurrentLevel(activeClass.lesson.level, course.currentLevel)
                ? course.activeClassId
                : null;
            return (
              <li key={course.id} className={styles.courseCard}>
                <div className={styles.courseInfo}>
                  <div className={styles.courseTop}>
                    <span className={styles.courseEyebrow}>{langLabel(course.targetLang)}</span>
                    <h2 className={styles.courseName}>{courseTitle}</h2>
                  </div>
                  <div className={styles.levelStrip}>
                    <div className={styles.levelTop}>
                      <span>Level</span>
                      <span>
                        <b>{course.currentLevel}</b> · {levelLabel(course.currentLevel)}
                      </span>
                    </div>
                    <div
                      className={styles.levelBar}
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`CEFR progress: ${course.currentLevel}`}
                    >
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    {isManualPlacement && (
                      <p className={styles.manualHint}>
                        You set this level yourself. You can take a class now at{' '}
                        {course.currentLevel}, or{' '}
                        <Link href={placementHref}>take the placement test</Link> if you want Sotto
                        to confirm it first.
                      </p>
                    )}
                  </div>
                </div>
                <div className={styles.courseActions}>
                  <StartNextClass courseId={course.id} activeClassId={activeClassId} />
                  <Link
                    href="/learn/practice"
                    className={styles.practiceLink}
                    aria-label={`Practice a single skill for ${courseTitle}`}
                  >
                    Practice
                  </Link>
                  <Link
                    href={`/learn/live?course=${course.id}`}
                    className={styles.practiceLink}
                    aria-label={`Live conversation for ${courseTitle}`}
                  >
                    Live
                  </Link>
                  <Link
                    href={`/learn/exams?course=${course.id}`}
                    className={styles.practiceLink}
                    aria-label={`Practice exam for ${courseTitle}`}
                  >
                    Exam
                  </Link>
                  <Link
                    href={placementHref}
                    className={styles.practiceLink}
                    aria-label={`${isManualPlacement ? 'Confirm' : 'Retake'} the placement test for ${courseTitle} (your level is never lowered)`}
                  >
                    {isManualPlacement ? 'Confirm level' : 'Retake placement'}
                  </Link>
                </div>
                <div className={styles.sourcedRow}>
                  <SourcedClassEntry courseId={course.id} activeClassId={activeClassId} />
                </div>
                <div className={styles.sourcedRow}>
                  <PedagogySelector courseId={course.id} current={course.pedagogy} />
                </div>
                <div className={styles.sourcedRow}>
                  <CourseNotesPanel courseId={course.id} />
                </div>
                <div className={styles.sourcedRow}>
                  <CourseClassHistory classes={course.classes} courseTitle={courseTitle} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.newCourse}>
        <Link href="/learn/placement" className={styles.newCourseLink}>
          + Start a new course
        </Link>
      </div>
    </main>
  );
}
