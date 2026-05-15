import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { listAiProviders, listByokProviders } from '@/lib/byok';
import { prisma } from '@/lib/prisma';
import { getAllAiProviderClientMeta } from '@/lib/providers/ai-registry';
import { getAllTtsProviderClientMeta } from '@/lib/providers/tts-registry';
import { attributeReferral } from '@/lib/referrals';
import { buildSetupReadiness } from '@/lib/setup-readiness';
import { NameStep } from './NameStep';
import { KeySetupForm } from './KeySetupForm';
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
    select: {
      hasCompletedOnboarding: true,
      name: true,
      preferredAiModel: true,
      preferredTtsProvider: true,
    },
  });

  if (user?.hasCompletedOnboarding) {
    redirect('/create');
  }

  // Name step is required for email signups without an OAuth display name.
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

  const [aiProviders, ttsProviders, privateFeedTokens] = await Promise.all([
    listAiProviders(userId),
    listByokProviders(userId),
    prisma.privateFeedToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        feedType: true,
        createdAt: true,
        lastUsedAt: true,
      },
    }),
  ]);

  const setupReadiness = buildSetupReadiness({
    hasDatabase: true,
    hasQueue: Boolean(process.env.REDIS_URL),
    storageProvider: process.env.STORAGE_PROVIDER,
    aiProviders,
    ttsProviders,
    privateFeedTokenCount: privateFeedTokens.length,
    selectedAiProvider: user.preferredAiModel,
    selectedTtsProvider: user.preferredTtsProvider,
  });

  return (
    <main className={styles.main}>
      <div className={styles.containerWide}>
        <header className={styles.header}>
          <h1 className={styles.title}>Set up your private audio workspace</h1>
          <p className={styles.subtitle}>
            Connect the pieces Sotto needs to generate private episodes and deliver them to your
            podcast app.
          </p>
        </header>

        <KeySetupForm
          setupReadiness={setupReadiness}
          initialAiConfigured={aiProviders}
          initialTtsConfigured={ttsProviders}
          initialPrivateFeedTokens={privateFeedTokens.map((token) => ({
            id: token.id,
            name: token.name,
            feedType: token.feedType,
            createdAt: token.createdAt.toISOString(),
            lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
          }))}
          aiProviderMeta={getAllAiProviderClientMeta()}
          ttsProviderMeta={getAllTtsProviderClientMeta()}
        />
      </div>
    </main>
  );
}
