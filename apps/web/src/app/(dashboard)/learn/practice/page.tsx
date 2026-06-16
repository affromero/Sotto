import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PracticePanel } from '@/components/learn/PracticePanel';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Practice' };

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

function langLabel(code: string): string {
  return LANG_LABELS[code.toLowerCase()] ?? code.toUpperCase();
}

interface PracticePageProps {
  searchParams?: Promise<{ course?: string; target?: string; auto?: string }>;
}

export default async function PracticePage({ searchParams }: PracticePageProps) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const params = (await searchParams) ?? {};

  const courses = await prisma.course.findMany({
    where: { userId },
    select: { id: true, targetLang: true, curriculum: { select: { title: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>Practice</h1>
        <p className={styles.subtitle}>
          Sharpen a single skill on your own time. Practice is ungated and feeds your memory graph.
          It&rsquo;s separate from your classes gated by mastery.
        </p>
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
        <div className={styles.panels}>
          {courses.map((course) => (
            <PracticePanel
              key={course.id}
              courseId={course.id}
              courseName={course.curriculum?.title ?? langLabel(course.targetLang)}
              initialFocusTargetId={params.course === course.id ? (params.target ?? null) : null}
              initialAutoMode={params.course === course.id ? (params.auto ?? null) : null}
            />
          ))}
        </div>
      )}

      <div className={styles.footerNav}>
        <Link href="/learn" className={styles.footerLink}>
          ← Back to courses
        </Link>
      </div>
    </main>
  );
}
