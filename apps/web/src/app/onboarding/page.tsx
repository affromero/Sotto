import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listAiProviders, listByokProviders } from '@/lib/byok';
import { generateQuestions } from '@/lib/taste-quiz';
import { QuizStep } from './QuizStep';
import { KeySetupForm } from './KeySetupForm';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Welcome to Sotto' };

interface OnboardingPageProps {
  searchParams: Promise<{ step?: string }>;
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/login');
  }

  const userId = session.user.id;
  const params = await searchParams;
  const step = params.step;

  // Attribute referral from cookie (fire-and-forget)
  const cookieStore = await cookies();
  const refHandle = cookieStore.get('sotto_ref')?.value;
  if (refHandle) {
    prisma.user.findUnique({ where: { id: userId }, select: { referredById: true } })
      .then(async (u) => {
        if (u && !u.referredById) {
          const referrer = await prisma.user.findFirst({
            where: { handle: refHandle },
            select: { id: true },
          });
          if (referrer && referrer.id !== userId) {
            await prisma.user.update({
              where: { id: userId },
              data: { referredById: referrer.id },
            });
          }
        }
      })
      .catch(() => {});
  }

  // Check if already onboarded — skip to keys step or create
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hasCompletedOnboarding: true },
  });

  if (user?.hasCompletedOnboarding && step !== 'keys') {
    redirect('/create');
  }

  // Key setup step
  if (step === 'keys') {
    const [aiKeys, ttsKeys] = await Promise.all([
      listAiProviders(userId),
      listByokProviders(userId),
    ]);

    const aiConfigured = aiKeys.map((k) => ({ provider: k.provider, isValid: k.isValid }));
    const ttsConfigured = ttsKeys.map((k) => ({ provider: k.provider, isValid: k.isValid }));

    return (
      <main className={styles.main}>
        <div className={styles.containerWide}>
          <header className={styles.header}>
            <h1 className={styles.title}>Get more podcasts</h1>
            <p className={styles.subtitle}>
              You&apos;ve hit your daily limit. Choose how you want to keep creating.
            </p>
          </header>

          {/* Two upgrade paths */}
          <div className={styles.upgradePaths}>
            <div className={styles.upgradePath}>
              <h2 className={styles.upgradePathTitle}>Upgrade to Pro</h2>
              <p className={styles.upgradePathDesc}>
                Unlimited generation, better AI, analytics, priority queue. No API keys needed.
                $12/month.
              </p>
              <a href="/pricing" className={styles.upgradeButtonPrimary}>
                Go Pro — $12/month
              </a>
            </div>
            <div className={styles.upgradePathDivider}>or</div>
            <div className={styles.upgradePath}>
              <h2 className={styles.upgradePathTitle}>Bring your own keys (free)</h2>
              <p className={styles.upgradePathDesc}>
                Use your own Anthropic / OpenAI + TTS keys. Unlimited generation at cost price.
                Unlimited generation at cost price. Pair with Pro for private podcasts, analytics, and more.
              </p>
              <KeySetupForm
                initialAiConfigured={aiConfigured}
                initialTtsConfigured={ttsConfigured}
              />
            </div>
          </div>
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
