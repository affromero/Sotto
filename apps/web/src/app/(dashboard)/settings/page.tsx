import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ONBOARDING_TAG_SLUGS } from '@/lib/tag-icons';
import { listByokProviders, listAiProviders } from '@/lib/byok';
import {
  getAllProviderMeta as getAllTtsProviderMeta,
  getProviderMeta as getTtsProviderMeta,
} from '@/lib/providers/tts-registry';
import { getDefaultModelForLanguage } from '@/lib/tts-language-support';
import {
  getAllSttProviderMeta,
  sttUsesTtsCredentials,
  type SttProviderId,
} from '@/lib/providers/stt-registry';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import { getServerInfra } from '@/lib/server-config';
import {
  getConfiguredTtsProviderId,
  isSpeechDisabled,
  selectTtsProviderId,
} from '@/lib/providers/tts';
import { SettingsForm } from './SettingsForm';
import { LocalAiSettings } from '@/components/settings/LocalAiSettings';
import { LocalSpeechSettings } from '@/components/settings/LocalSpeechSettings';
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

  const [
    user,
    userInterests,
    categories,
    effectiveTtsKeys,
    effectiveAiKeys,
    latestCourse,
    autoConfig,
    infra,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        image: true,
        role: true,
        preferredLanguage: true,
        preferredTtsModel: true,
        preferredTtsProvider: true,
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
    listByokProviders(userId, true),
    listAiProviders(userId, true),
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

  const accessibleTtsProviders = new Set<string>([
    ...effectiveTtsKeys.filter((k) => k.isValid).map((k) => k.provider),
  ]);
  const accessibleAiProviders = new Set<string>([
    ...effectiveAiKeys.filter((k) => k.isValid).map((k) => k.provider),
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
  const configuredTtsProvider = getConfiguredTtsProviderId();
  const selectedTtsProvider = isSpeechDisabled(user)
    ? 'disabled'
    : selectTtsProviderId(user.preferredTtsProvider, configuredTtsProvider);
  const configuredTtsMeta = configuredTtsProvider
    ? getTtsProviderMeta(configuredTtsProvider)
    : null;
  const selectedTtsMeta =
    selectedTtsProvider && selectedTtsProvider !== 'disabled'
      ? getTtsProviderMeta(selectedTtsProvider)
      : null;
  const speechLanguage = latestCourse?.targetLang ?? user.preferredLanguage ?? null;
  const configuredDefaultModel =
    !configuredTtsProvider || !configuredTtsMeta
      ? null
      : speechLanguage
        ? getDefaultModelForLanguage(
            configuredTtsProvider,
            speechLanguage,
            configuredTtsMeta.defaultModel
          )
        : configuredTtsMeta.defaultModel;
  const configuredModelLabel =
    configuredTtsMeta?.models.find((model) => model.id === configuredDefaultModel)?.displayName ??
    configuredDefaultModel;
  if (selectedTtsProvider === 'local' && user.preferredTtsModel) {
    const localMeta = speechTtsProviderMeta.find((meta) => meta.id === 'local');
    if (localMeta && !localMeta.models.some((model) => model.id === user.preferredTtsModel)) {
      localMeta.models.push({
        id: user.preferredTtsModel,
        displayName: user.preferredTtsModel,
        tier: 'standard',
        supportedLanguages: localMeta.models[0]?.supportedLanguages ?? [],
      });
    }
  }
  const selectedSttProvider = (infra.sttProvider ?? autoConfig.model.sttProvider) as string;
  if (selectedTtsProvider === 'kokoro' || selectedTtsProvider === 'local') {
    if (infra.ttsBaseUrl) accessibleTtsProviders.add(selectedTtsProvider);
  }
  if (selectedSttProvider === 'local') {
    if (infra.sttBaseUrl) accessibleAiProviders.add('local');
  }
  if (accessibleTtsProviders.has('elevenlabs')) {
    accessibleAiProviders.add('elevenlabs');
  }
  for (const key of effectiveTtsKeys) {
    if (key.isValid) continue;
    accessibleTtsProviders.delete(key.provider);
    if (sttUsesTtsCredentials(key.provider as SttProviderId))
      accessibleAiProviders.delete(key.provider);
  }
  for (const key of effectiveAiKeys) {
    if (!key.isValid) accessibleAiProviders.delete(key.provider);
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
        key={`${selectedTtsProvider}:${user.preferredTtsModel ?? ''}`}
        initialName={user.name ?? ''}
        email={user.email}
        image={user.image}
        role={user.role}
        preferredLanguage={user.preferredLanguage}
        speechLanguage={speechLanguage}
        selectedTtsProvider={selectedTtsProvider}
        selectedSttProvider={selectedSttProvider}
        ttsProviderAvailable={
          selectedTtsProvider !== null && accessibleTtsProviders.has(selectedTtsProvider)
        }
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

      {user.role === 'ADMIN' && (
        <LocalAiSettings
          initialBaseUrl={infra.aiBaseUrl ?? ''}
          initialModel={infra.aiModel ?? ''}
        />
      )}

      <LocalSpeechSettings
        canManageSharedSpeech={session?.isOwner === true}
        key={`${selectedTtsProvider}:${user.preferredTtsModel ?? ''}:${infra.ttsBaseUrl ?? ''}`}
        initialEndpoint={infra.ttsBaseUrl ?? ''}
        initialModel={selectedTtsProvider === 'local' ? (user.preferredTtsModel ?? '') : ''}
        initialVoices={(infra.ttsVoices ?? '')
          .split(',')
          .map((voice) => voice.trim())
          .filter(Boolean)}
        initialMode={
          selectedTtsProvider === 'local' || selectedTtsProvider === 'disabled'
            ? selectedTtsProvider
            : 'configured'
        }
        configuredProviderLabel={configuredTtsMeta?.displayName ?? null}
        configuredModelLabel={configuredModelLabel}
        selectedProviderLabel={selectedTtsMeta?.displayName ?? null}
        initialUsesConfiguredProvider={
          !user.preferredTtsProvider?.trim() && !user.preferredTtsModel?.trim()
        }
      />

      <CourseManagement courses={managedCourses} />
    </main>
  );
}
