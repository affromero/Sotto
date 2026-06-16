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
          Live conversation needs a <em>Google Gemini key</em>.
        </h1>
        <p className={styles.gateText}>
          This mode is a real-time speaking room for {langLabel(course.targetLang)}. You talk in
          your own language, Gemini translates and replies aloud, and Sotto turns the exchange into
          practice at your current {course.currentLevel} level.
        </p>
        <section className={styles.gateBrief} aria-label="What live conversation unlocks">
          <div className={styles.gateCard}>
            <span className={styles.gateCardTitle}>What you unlock</span>
            <ul className={styles.gateList}>
              <li>Live roleplay for travel, work, study, or your course topics.</li>
              <li>
                Real-time translation back into {langLabel(course.nativeLang)} while you listen.
              </li>
              <li>Speaking practice that can reuse your level, course notes, and vocabulary.</li>
            </ul>
          </div>
          <div className={styles.gateCard}>
            <span className={styles.gateCardTitle}>Why a key is required</span>
            <p className={styles.gateCardText}>
              Audio has to stream to Gemini Live for low-latency speech. Sotto does not send that
              audio through a shared fallback key; it waits until you provide your own.
            </p>
          </div>
          <div className={styles.gateCard}>
            <span className={styles.gateCardTitle}>What gets sent</span>
            <p className={styles.gateCardText}>
              During a live session, your microphone audio and the target conversation context are
              sent to Google. Regular classes, practice, and exams still work without this key.
            </p>
          </div>
        </section>
        <div className={styles.gateActions}>
          <Link href="/settings" className={styles.gateLink}>
            Add Gemini key
          </Link>
          <Link href="/learn" className={styles.gateBack}>
            Choose another activity
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
