import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ONBOARDING_TAG_SLUGS } from '@/lib/tag-icons';
import { listByokProviders, listAiProviders } from '@/lib/byok';
import { getAllProviderMeta as getAllTtsProviderMeta } from '@/lib/providers/tts-registry';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import { getServerInfra } from '@/lib/server-config';
import { getConfiguredTtsProviderId } from '@/lib/providers/tts';
import { SettingsForm } from './SettingsForm';
import { CourseManagement } from '@/components/settings/CourseManagement';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  const [user, userInterests, categories, byokKeys, aiKeys, latestCourse, autoConfig, infra] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          email: true,
          image: true,
          role: true,
          preferredLanguage: true,
          preferredTtsModel: true,
          preferredSttModel: true,
          preferredAiModel: true,
          emailNotifications: true,
          pushNotifications: true,
          showAgentUsageStatus: true,
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
      prisma.course.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { targetLang: true },
      }),
      getAutoModelConfig(),
      getServerInfra(),
    ]);

  if (!user) return null;

  const selectedInterestTagIds = userInterests.map((i) => i.tagId);

  // Sort categories by the order defined in ONBOARDING_TAG_SLUGS
  const slugOrder = new Map(ONBOARDING_TAG_SLUGS.map((s, i) => [s, i]));
  categories.sort((a, b) => (slugOrder.get(a.slug) ?? 99) - (slugOrder.get(b.slug) ?? 99));

  const configuredProviders = byokKeys.map((k) => ({ provider: k.provider, isValid: k.isValid }));
  const configuredAiProviders = aiKeys.map((k) => ({ provider: k.provider, isValid: k.isValid }));
  const adminUser = await prisma.user.findFirst({
    where: { role: 'ADMIN', id: { not: userId } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const [adminTtsKeys, adminAiKeys] = adminUser
    ? await Promise.all([listByokProviders(adminUser.id), listAiProviders(adminUser.id)])
    : [[], []];
  const accessibleTtsProviders = new Set<string>([
    ...configuredProviders.filter((k) => k.isValid).map((k) => k.provider),
    ...adminTtsKeys.filter((k) => k.isValid).map((k) => k.provider),
  ]);
  const accessibleAiProviders = new Set<string>([
    ...configuredAiProviders.filter((k) => k.isValid).map((k) => k.provider),
    ...adminAiKeys.filter((k) => k.isValid).map((k) => k.provider),
  ]);
  const speechTtsProviderMeta = getAllTtsProviderMeta().map((meta) => ({
    id: meta.id,
    displayName: meta.displayName,
    models: meta.models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      tier: model.tier,
      supportedLanguages: [...model.supportedLanguages],
    })),
  }));
  const sttProviderMeta = getAllSttProviderMeta().map((meta) => ({
    id: meta.id,
    displayName: meta.displayName,
    defaultModel: meta.defaultModel,
    models: meta.models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      tier: model.tier,
      supportedLanguages: [...model.supportedLanguages],
    })),
  }));
  const selectedTtsProvider = getConfiguredTtsProviderId() ?? autoConfig.model.ttsProvider;
  const selectedSttProvider = (infra.sttProvider ?? autoConfig.model.sttProvider) as string;
  if (selectedTtsProvider === 'kokoro' || selectedTtsProvider === 'local') {
    if (infra.ttsBaseUrl) accessibleTtsProviders.add(selectedTtsProvider);
  }
  if (selectedSttProvider === 'local') {
    if (infra.sttBaseUrl) accessibleAiProviders.add('local');
  }
  if (process.env.ELEVENLABS_API_KEY) accessibleTtsProviders.add('elevenlabs');
  if (process.env.OPENAI_API_KEY) {
    accessibleTtsProviders.add('openai');
    accessibleAiProviders.add('openai');
  }
  if (process.env.CARTESIA_API_KEY) accessibleTtsProviders.add('cartesia');
  if (process.env.HUME_API_KEY) accessibleTtsProviders.add('hume');
  if (process.env.FAL_KEY) {
    accessibleTtsProviders.add('fal');
    accessibleTtsProviders.add('minimax');
  }
  if (process.env.REPLICATE_API_TOKEN) accessibleTtsProviders.add('replicate');
  if (process.env.MISTRAL_API_KEY) accessibleTtsProviders.add('mistral');
  if (process.env.TOGETHER_API_KEY) accessibleAiProviders.add('together');
  if (process.env.DEEPGRAM_API_KEY) accessibleAiProviders.add('deepgram');
  if (process.env.ASSEMBLYAI_API_KEY) accessibleAiProviders.add('assemblyai');
  if (process.env.ELEVENLABS_API_KEY || accessibleTtsProviders.has('elevenlabs')) {
    accessibleAiProviders.add('elevenlabs');
  }

  const managedCourses = (
    await prisma.course.findMany({
      where: { userId },
      select: {
        id: true,
        nativeLang: true,
        targetLang: true,
        currentLevel: true,
        curriculum: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  ).map((course) => ({
    id: course.id,
    nativeLang: course.nativeLang,
    targetLang: course.targetLang,
    currentLevel: course.currentLevel,
    title: course.curriculum?.title ?? '',
  }));

  return (
    <main className={styles.main}>
      <h1 className={styles.pageTitle}>Settings</h1>

      <SettingsForm
        initialName={user.name ?? ''}
        email={user.email}
        image={user.image}
        role={user.role}
        preferredLanguage={user.preferredLanguage}
        speechLanguage={user.preferredLanguage ?? latestCourse?.targetLang ?? null}
        selectedTtsProvider={selectedTtsProvider}
        selectedSttProvider={selectedSttProvider}
        ttsProviderAvailable={accessibleTtsProviders.has(selectedTtsProvider)}
        sttProviderAvailable={accessibleAiProviders.has(selectedSttProvider)}
        initialPreferredTtsModel={user.preferredTtsModel}
        initialPreferredSttModel={user.preferredSttModel}
        initialPreferredAiModel={user.preferredAiModel}
        interestCategories={categories}
        selectedInterestTagIds={selectedInterestTagIds}
        speechTtsProviderMeta={speechTtsProviderMeta}
        sttProviderMeta={sttProviderMeta}
        initialEmailNotifications={user.emailNotifications}
        initialPushNotifications={user.pushNotifications}
        initialShowAgentUsageStatus={user.showAgentUsageStatus}
      />

      <CourseManagement courses={managedCourses} />
    </main>
  );
}
