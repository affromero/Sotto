import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ONBOARDING_TAG_SLUGS } from '@/lib/tag-icons';
import { listByokProviders, listAiProviders } from '@/lib/byok';
import { getAllAiProviderClientMeta } from '@/lib/providers/ai-registry';
import { getAllTtsProviderClientMeta } from '@/lib/providers/tts-registry';
import { SettingsForm } from './SettingsForm';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  const [user, accounts, voiceClones, userInterests, categories, byokKeys, aiKeys, quizAnswerCount, referralCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        handle: true,
        image: true,
        bio: true,
        role: true,
        twitterHandle: true,
        twitterEnabled: true,
        voicePreferences: { select: { speaker: true, voiceId: true } },
        preferredLanguage: true,
        emailNotifications: true,
        pushNotifications: true,
      },
    }),
    prisma.account.findMany({
      where: { userId },
      select: {
        provider: true,
      },
    }),
    prisma.voiceClone.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        externalVoiceId: true,
      },
    }),
    prisma.userInterest.findMany({
      where: { userId, weight: { gt: 0 } },
      select: { tagId: true },
    }),
    prisma.tag.findMany({
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
    }),
    listByokProviders(userId),
    listAiProviders(userId),
    prisma.tasteQuizAnswer.count({ where: { userId } }),
    prisma.user.count({ where: { referredById: userId } }),
  ]);

  if (!user) return null;

  const connectedProviders = accounts.map((a) => a.provider);
  const selectedInterestTagIds = userInterests.map((i) => i.tagId);

  // Sort categories by the order defined in ONBOARDING_TAG_SLUGS
  const slugOrder = new Map(ONBOARDING_TAG_SLUGS.map((s, i) => [s, i]));
  categories.sort((a, b) => (slugOrder.get(a.slug) ?? 99) - (slugOrder.get(b.slug) ?? 99));

  const configuredProviders = byokKeys.map((k) => ({ provider: k.provider, isValid: k.isValid }));
  const configuredAiProviders = aiKeys.map((k) => ({ provider: k.provider, isValid: k.isValid }));
  const aiProviderMeta = getAllAiProviderClientMeta();
  const ttsProviderMeta = getAllTtsProviderClientMeta();
  const isTwitterProviderAvailable = !!process.env.TWITTER_CLIENT_ID && !!process.env.TWITTER_CLIENT_SECRET;

  return (
    <main className={styles.main}>
      <h1 className={styles.pageTitle}>Settings</h1>

      <SettingsForm
        initialName={user.name ?? ''}
        initialBio={user.bio ?? ''}
        initialHandle={user.handle ?? ''}
        email={user.email}
        image={user.image}
        role={user.role}
        connectedProviders={connectedProviders}
        twitterHandle={user.twitterHandle}
        twitterEnabled={user.twitterEnabled}
        voicePreferences={user.voicePreferences}
        preferredLanguage={user.preferredLanguage}
        voiceClones={voiceClones}
        interestCategories={categories}
        selectedInterestTagIds={selectedInterestTagIds}
        configuredTtsProviders={configuredProviders}
        configuredAiProviders={configuredAiProviders}
        aiProviderMeta={aiProviderMeta}
        ttsProviderMeta={ttsProviderMeta}
        isTwitterProviderAvailable={isTwitterProviderAvailable}
        initialEmailNotifications={user.emailNotifications}
        initialPushNotifications={user.pushNotifications}
        quizAnswerCount={quizAnswerCount}
        referralCount={referralCount}
      />
    </main>
  );
}
