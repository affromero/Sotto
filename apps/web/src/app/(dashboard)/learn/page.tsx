import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { StartNextClass } from '@/components/learn/StartNextClass';
import { SourcedClassEntry } from '@/components/learn/SourcedClassEntry';
import { CefrDisclaimer } from '@/components/learn/CefrDisclaimer';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Learn' };

const LANG_LABELS: Record<string, string> = {
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  pt: 'Portuguese',
  it: 'Italian',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
};

const LEVEL_LABELS: Record<string, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper-Intermediate',
  C1: 'Advanced',
  C2: 'Mastery',
};

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function langLabel(code: string): string {
  return LANG_LABELS[code.toLowerCase()] ?? code.toUpperCase();
}

function levelLabel(level: string): string {
  return LEVEL_LABELS[level] ?? level;
}

/** Fraction (0..1) of the CEFR ladder this level represents, for the strip fill. */
function levelFraction(level: string): number {
  const i = CEFR_ORDER.indexOf(level);
  if (i < 0) return 0;
  return (i + 1) / CEFR_ORDER.length;
}

export default async function LearnPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const courses = await prisma.course.findMany({
    where: { userId },
    select: {
      id: true,
      targetLang: true,
      currentLevel: true,
      activeClassId: true,
      curriculum: { select: { title: true } },
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
          Each course moves through mastery-gated classes. Resume the next class, or sharpen a
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
            No active courses yet. Take a quick placement test and we&rsquo;ll start you at the right
            level.
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
            return (
              <li key={course.id} className={styles.courseCard}>
                <div className={styles.courseInfo}>
                  <div className={styles.courseTop}>
                    <span className={styles.courseEyebrow}>{langLabel(course.targetLang)}</span>
                    <h2 className={styles.courseName}>
                      {course.curriculum?.title ?? langLabel(course.targetLang)}
                    </h2>
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
                  </div>
                </div>
                <div className={styles.courseActions}>
                  <Link
                    href="/learn/practice"
                    className={styles.practiceLink}
                    aria-label={`Practice a single skill for ${course.curriculum?.title ?? langLabel(course.targetLang)}`}
                  >
                    Practice
                  </Link>
                  <Link
                    href={`/learn/live?course=${course.id}`}
                    className={styles.practiceLink}
                    aria-label={`Live conversation for ${course.curriculum?.title ?? langLabel(course.targetLang)}`}
                  >
                    Live
                  </Link>
                  <StartNextClass courseId={course.id} activeClassId={course.activeClassId ?? null} />
                </div>
                <div className={styles.sourcedRow}>
                  <SourcedClassEntry
                    courseId={course.id}
                    activeClassId={course.activeClassId ?? null}
                  />
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
