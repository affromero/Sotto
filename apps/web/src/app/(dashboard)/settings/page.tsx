import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ONBOARDING_TAG_SLUGS } from '@/lib/tag-icons';
import { listByokProviders, listAiProviders } from '@/lib/byok';
import { getAllAiProviderClientMeta } from '@/lib/providers/ai-registry';
import { getAllTtsProviderClientMeta } from '@/lib/providers/tts-registry';
import { isClaudeAvailable } from '@/lib/claude-code-client';
import { isCodexAvailable } from '@/lib/codex-client';
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

  const [
    user,
    userInterests,
    categories,
    byokKeys,
    aiKeys,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        handle: true,
        image: true,
        preferredLanguage: true,
        preferredAiModel: true,
        emailNotifications: true,
        pushNotifications: true,
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
  ]);

  if (!user) return null;

  const selectedInterestTagIds = userInterests.map((i) => i.tagId);

  // Sort categories by the order defined in ONBOARDING_TAG_SLUGS
  const slugOrder = new Map(ONBOARDING_TAG_SLUGS.map((s, i) => [s, i]));
  categories.sort((a, b) => (slugOrder.get(a.slug) ?? 99) - (slugOrder.get(b.slug) ?? 99));

  const configuredProviders = byokKeys.map((k) => ({ provider: k.provider, isValid: k.isValid }));
  const configuredAiProviders = aiKeys.map((k) => ({ provider: k.provider, isValid: k.isValid }));
  const aiProviderMeta = getAllAiProviderClientMeta();
  const ttsProviderMeta = getAllTtsProviderClientMeta();
  const [claudeCodeAvailable, codexAvailable] = await Promise.all([
    isClaudeAvailable(),
    isCodexAvailable(),
  ]);
  const aiSystemProviders = [
    {
      id: 'claude-code',
      label: 'Claude Code',
      description: 'Linked via the local Claude Code CLI. No API key needed.',
      available: claudeCodeAvailable,
    },
    {
      id: 'codex',
      label: 'Codex',
      description: 'Linked via the local Codex CLI. No API key needed.',
      available: codexAvailable,
    },
  ];

  return (
    <main className={styles.main}>
      <h1 className={styles.pageTitle}>Settings</h1>

      <SettingsForm
        initialName={user.name ?? ''}
        initialHandle={user.handle ?? ''}
        email={user.email}
        image={user.image}
        preferredLanguage={user.preferredLanguage}
        initialPreferredAiModel={user.preferredAiModel}
        interestCategories={categories}
        selectedInterestTagIds={selectedInterestTagIds}
        configuredTtsProviders={configuredProviders}
        configuredAiProviders={configuredAiProviders}
        aiProviderMeta={aiProviderMeta}
        aiSystemProviders={aiSystemProviders}
        ttsProviderMeta={ttsProviderMeta}
        initialEmailNotifications={user.emailNotifications}
        initialPushNotifications={user.pushNotifications}
      />
    </main>
  );
}
