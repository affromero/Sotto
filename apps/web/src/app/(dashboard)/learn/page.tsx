import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { StartNextClass } from '@/components/learn/StartNextClass';
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

function langLabel(code: string): string {
  return LANG_LABELS[code.toLowerCase()] ?? code.toUpperCase();
}

function levelLabel(level: string): string {
  return LEVEL_LABELS[level] ? `${level} — ${LEVEL_LABELS[level]}` : level;
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
        <h1 className={styles.title}>Learn</h1>
        <p className={styles.subtitle}>Your language courses and class queue.</p>
      </header>

      {courses.length === 0 ? (
        <section className={styles.empty}>
          <p className={styles.emptyText}>
            You have no active courses yet. Take a placement test to get started.
          </p>
          <Link href="/learn/placement" className={styles.ctaButton}>
            Take Placement Test
          </Link>
        </section>
      ) : (
        <ul className={styles.courseList} role="list">
          {courses.map((course) => (
            <li key={course.id} className={styles.courseCard}>
              <div className={styles.courseInfo}>
                <h2 className={styles.courseName}>
                  {course.curriculum?.title ?? langLabel(course.targetLang)}
                </h2>
                <p className={styles.courseLevel}>{levelLabel(course.currentLevel)}</p>
              </div>
              <StartNextClass
                courseId={course.id}
                activeClassId={course.activeClassId ?? null}
              />
            </li>
          ))}
        </ul>
      )}

      <div className={styles.newCourse}>
        {courses.length > 0 && (
          <Link href="/learn/practice" className={styles.newCourseLink}>
            Practice a single skill →
          </Link>
        )}
        <Link href="/learn/placement" className={styles.newCourseLink}>
          + Start a new course
        </Link>
      </div>
    </main>
  );
}
