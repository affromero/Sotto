import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { learningLevelSchema, LANGUAGE_DISPLAY } from '@sotto/shared';
import { LearningMapPanel } from '@/components/learn/learning-map/LearningMapPanel';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Learning map' };

export default async function LearningMapPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string; level?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const params = await searchParams;
  const courses = await prisma.course.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      targetLang: true,
      currentLevel: true,
      curriculum: { select: { title: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const selected = params.course
    ? courses.find((course) => course.id === params.course)
    : courses[0];
  const parsedLevel = learningLevelSchema.safeParse(params.level);
  return (
    <main className={styles.root}>
      <nav className={styles.navigation} aria-label="Learning map navigation">
        <Link href="/learn">Back to courses</Link>
        <Link
          href={
            selected
              ? `/learn/practice?course=${encodeURIComponent(selected.id)}`
              : '/learn/practice'
          }
        >
          Practice history
        </Link>
      </nav>
      {courses.length > 1 && (
        <nav className={styles.courses} aria-label="Choose course">
          {courses.map((course) => (
            <Link
              key={course.id}
              href={`/learn/map?course=${encodeURIComponent(course.id)}`}
              aria-current={selected?.id === course.id ? 'page' : undefined}
            >
              {LANGUAGE_DISPLAY[course.targetLang] ?? course.targetLang} · {course.currentLevel}
            </Link>
          ))}
        </nav>
      )}
      {selected ? (
        <LearningMapPanel
          key={selected.id}
          courseId={selected.id}
          courseName={
            selected.curriculum?.title ??
            LANGUAGE_DISPLAY[selected.targetLang] ??
            selected.targetLang
          }
          initialLevel={parsedLevel.success ? parsedLevel.data : undefined}
          sourceCourse={{
            targetLang: selected.targetLang,
            currentLevel: learningLevelSchema.parse(selected.currentLevel),
          }}
        />
      ) : (
        <section>
          <h1>Learning map</h1>
          <p>
            {params.course
              ? 'This course is unavailable for the active learner.'
              : 'Choose a language and complete placement to see its learning map.'}
          </p>
          <Link href="/learn/placement">Choose a language</Link>
        </section>
      )}
    </main>
  );
}
