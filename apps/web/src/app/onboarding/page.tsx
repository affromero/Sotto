import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ONBOARDING_TAG_SLUGS } from '@/lib/tag-icons';
import { listAiProviders, listByokProviders } from '@/lib/byok';
import { OnboardingForm } from './OnboardingForm';
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

    const aiConfigured = aiKeys.filter((k) => k.isValid).map((k) => k.provider);
    const ttsConfigured = ttsKeys.filter((k) => k.isValid).map((k) => k.provider);

    return (
      <main className={styles.main}>
        <div className={styles.containerWide}>
          <header className={styles.header}>
            <h1 className={styles.title}>Connect your API keys</h1>
            <p className={styles.subtitle}>
              Sotto is BYOK (Bring Your Own Key). Connect your AI and TTS provider keys to start
              creating podcasts.
            </p>
          </header>

          <KeySetupForm
            initialAiConfigured={aiConfigured}
            initialTtsConfigured={ttsConfigured}
          />
        </div>
      </main>
    );
  }

  // Interest selection step (default) — fetch parent categories with children
  const categories = await prisma.tag.findMany({
    where: { slug: { in: ONBOARDING_TAG_SLUGS } },
    select: {
      id: true,
      name: true,
      slug: true,
      children: {
        select: { id: true, name: true, slug: true },
        orderBy: { name: 'asc' },
      },
    },
  });

  const slugOrder = new Map(ONBOARDING_TAG_SLUGS.map((s, i) => [s, i]));
  categories.sort((a, b) => (slugOrder.get(a.slug) ?? 99) - (slugOrder.get(b.slug) ?? 99));

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>What are you curious about?</h1>
          <p className={styles.subtitle}>
            Pick topics that interest you. This helps us personalize your experience.
          </p>
        </header>

        <OnboardingForm categories={categories} />
      </div>
    </main>
  );
}
