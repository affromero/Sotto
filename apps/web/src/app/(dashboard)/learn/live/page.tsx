import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canLiveTranslate } from '@/lib/live-translate';
import { LiveConversation } from '@/components/learn/LiveConversation';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Live conversation' };

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

interface PageProps {
  searchParams: Promise<{ course?: string }>;
}

export default async function LivePage({ searchParams }: PageProps) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const { course: courseId } = await searchParams;

  const course = await prisma.course.findFirst({
    where: courseId ? { id: courseId, userId } : { userId },
    orderBy: courseId ? undefined : { createdAt: 'desc' },
    select: { id: true, nativeLang: true, targetLang: true, currentLevel: true },
  });
  if (!course) redirect('/learn');

  // Explicit feature gate (not a provider fallback): Live needs a real Google key.
  if (!(await canLiveTranslate(userId))) {
    return (
      <main className={styles.gate}>
        <div className={styles.gateEyebrow}>Live conversation</div>
        <h1 className={styles.gateTitle}>
          Add a Google key to <em>unlock live conversation</em>.
        </h1>
        <p className={styles.gateText}>
          Live conversation streams your speech to Gemini and speaks the translation back in real
          time. It runs on your own Google (Gemini) API key, so nothing leaves your server without
          one.
        </p>
        <div className={styles.gateActions}>
          <Link href="/settings" className={styles.gateLink}>
            Add a Google key
          </Link>
          <Link href="/learn" className={styles.gateBack}>
            Back to courses
          </Link>
        </div>
      </main>
    );
  }

  return (
    <LiveConversation
      courseId={course.id}
      nativeLabel={langLabel(course.nativeLang)}
      targetLabel={langLabel(course.targetLang)}
      level={course.currentLevel}
    />
  );
}
