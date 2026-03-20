import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateQuestions } from '@/lib/taste-quiz';
import { attributeReferral } from '@/lib/referrals';
import { NameStep } from './NameStep';
import { QuizStep } from './QuizStep';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Welcome to Sotto',
  robots: { index: false, follow: false },
};

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/login');
  }

  const userId = session.user.id;

  // Attribute referral from cookie (fire-and-forget, notifies referrer)
  const cookieStore = await cookies();
  const refHandle = cookieStore.get('sotto_ref')?.value;
  if (refHandle) {
    attributeReferral(userId, refHandle)
      .then((attributed) => {
        if (attributed) {
          cookieStore.delete('sotto_ref');
        }
      })
      .catch(() => {});
  }

  // Check if already onboarded — skip to keys step or create
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hasCompletedOnboarding: true, name: true },
  });

  if (user?.hasCompletedOnboarding) {
    redirect('/create');
  }

  // Name step — required before taste quiz for email signups (no OAuth name)
  if (!user?.name?.trim()) {
    return (
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1 className={styles.title}>What should we call you?</h1>
            <p className={styles.subtitle}>
              This is how you&apos;ll appear on Sotto.
            </p>
          </header>

          <NameStep />
        </div>
      </main>
    );
  }

  // Taste quiz step (default) — generate initial questions
  let initialQuestions: Awaited<ReturnType<typeof generateQuestions>> = [];
  try {
    initialQuestions = await generateQuestions(userId, 10);
  } catch {
    // If question generation fails (no LLM configured), show empty quiz
    // which will show loading state and user can skip
  }

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Let&apos;s find podcasts you&apos;ll love</h1>
          <p className={styles.subtitle}>
            Just say yes or no — it takes 30 seconds.
          </p>
        </header>

        <QuizStep initialQuestions={initialQuestions} />
      </div>
    </main>
  );
}
