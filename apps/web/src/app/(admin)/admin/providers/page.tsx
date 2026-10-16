import { auth } from '@/lib/auth';
import { getAutoModelConfig, resolveDisabledSystemAiProviders } from '@/lib/auto-model-config';
import { listAiProviders, listByokProviders } from '@/lib/byok';
import { getAgentStatus } from '@/lib/agent-availability';
import { credentialReloadAvailable } from '@/lib/agent-credentials';
import { getAgentModelOffering } from '@/lib/agent-models';
import { getAllAiProviderClientMeta, getAllAiProviderMeta } from '@/lib/providers/ai-registry';
import {
  getAllProviderMeta,
  getAllTtsProviderClientMeta,
  getProviderMeta,
} from '@/lib/providers/tts-registry';
import { getServerInfra } from '@/lib/server-config';
import { prisma } from '@/lib/prisma';
import { selectTtsProviderId, selectedTtsModel, isSpeechDisabled } from '@/lib/providers/tts';
import { getDefaultModelForLanguage } from '@/lib/tts-language-support';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';
import { getTestableProviders } from '@/lib/admin/testable-providers';
import { ProvidersTabs } from './ProvidersTabs';
import styles from '@/app/(admin)/adminTheme.styles';

export const metadata = { title: 'Providers & models · Sotto admin' };

export default async function AdminProvidersPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [config, testable, byokKeys, aiKeys, claudeStatus, codexStatus, infra, user, latestCourse] =
    await Promise.all([
      getAutoModelConfig(),
      getTestableProviders(userId),
      listByokProviders(userId),
      listAiProviders(userId),
      getAgentStatus('claude-code'),
      getAgentStatus('codex'),
      getServerInfra(),
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { preferredTtsProvider: true, preferredTtsModel: true, preferredLanguage: true },
      }),
      prisma.course.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { targetLang: true },
      }),
    ]);
  const configured = getProviderMeta(config.model.ttsProvider);
  const selected = selectTtsProviderId(user.preferredTtsProvider, config.model.ttsProvider);
  const language = latestCourse?.targetLang ?? user.preferredLanguage;
  const configuredModel = language
    ? getDefaultModelForLanguage(config.model.ttsProvider, language, config.model.ttsModel)
    : config.model.ttsModel;
  const configuredTtsProviders = byokKeys.map((k) => ({
    provider: k.provider,
    isValid: k.isValid,
  }));
  const configuredAiProviders = aiKeys.map((k) => ({ provider: k.provider, isValid: k.isValid }));
  const disabledSystemAiProviders = resolveDisabledSystemAiProviders(config);
  const [claudeOffering, codexOffering] = await Promise.all([
    getAgentModelOffering('claude-code', { autoConfig: config }),
    getAgentModelOffering('codex', { autoConfig: config }),
  ]);
  const agentModels = {
    'claude-code': claudeOffering.models,
    codex: codexOffering.models,
  };
  const aiSystemProviders = [
    {
      id: 'claude-code',
      label: 'Claude Code',
      description: 'Linked via the local Claude Code CLI. No API key needed.',
      available: claudeStatus.readiness === 'ready',
      readiness: claudeStatus.readiness,
      credentialReloadAvailable: credentialReloadAvailable('claude-code'),
      disabled: disabledSystemAiProviders.has('claude-code'),
    },
    {
      id: 'codex',
      label: 'Codex',
      description: 'Linked via the local Codex CLI. No API key needed.',
      available: codexStatus.readiness === 'ready',
      readiness: codexStatus.readiness,
      credentialReloadAvailable: credentialReloadAvailable('codex'),
      disabled: disabledSystemAiProviders.has('codex'),
    },
  ];

  // STT-only providers live in the AI registry for the key store but are not
  // language models — keep them out of the "Language model" picker.
  const STT_ONLY_AI = new Set(['deepgram', 'assemblyai', 'together', 'gladia', 'speechmatics']);
  const aiProviders = getAllAiProviderMeta()
    .filter((p) => !STT_ONLY_AI.has(p.id))
    .filter((p) => !disabledSystemAiProviders.has(p.id as 'claude-code' | 'codex'))
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      ...(p.id === 'claude-code'
        ? { discoverySource: claudeOffering.source, discoveryError: claudeOffering.error }
        : p.id === 'codex'
          ? { discoverySource: codexOffering.source, discoveryError: codexOffering.error }
          : {}),
      models: (p.id === 'claude-code' || p.id === 'codex' ? agentModels[p.id] : p.models).map(
        (m) => ({
          id: m.id,
          displayName: m.displayName,
          tier: m.tier,
          price: m.pricing
            ? `$${m.pricing.inputPerMTok}/$${m.pricing.outputPerMTok} per MTok`
            : undefined,
        })
      ),
    }));

  const ttsProviders = getAllProviderMeta().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    models: p.models.map((m) => ({ id: m.id, displayName: m.displayName, tier: m.tier })),
  }));

  const sttProviders = getAllSttProviderMeta().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    models: p.models.map((m) => ({ id: m.id, displayName: m.displayName, tier: m.tier })),
  }));

  return (
    <>
      <div className={styles.adminHead}>
        <div>
          <h1>Providers &amp; models</h1>
          <div className={styles.ahSub}>
            Bring your own keys · choose defaults per task · test before you save
          </div>
        </div>
      </div>

      <ProvidersTabs
        speech={{
          initialEndpoint: infra.ttsBaseUrl ?? '',
          initialModel:
            selected === 'local'
              ? (selectedTtsModel(user, selected, config.model) ??
                getProviderMeta(selected).defaultModel)
              : getProviderMeta('local').defaultModel,
          initialVoices: (infra.ttsVoices ?? '')
            .split(',')
            .map((voice) => voice.trim())
            .filter(Boolean),
          initialMode: isSpeechDisabled(user)
            ? 'disabled'
            : selected === 'local'
              ? 'local'
              : 'configured',
          configuredProviderLabel: configured.displayName,
          configuredModelLabel:
            configured.models.find((model) => model.id === configuredModel)?.displayName ??
            configuredModel,
          selectedProviderLabel: selected ? getProviderMeta(selected).displayName : null,
          initialUsesConfiguredProvider:
            !user.preferredTtsProvider?.trim() && !user.preferredTtsModel?.trim(),
          canManageSharedSpeech: session?.isOwner === true,
        }}
        autoModels={{ initialConfig: config, aiProviders, ttsProviders, sttProviders }}
        keys={{
          configuredAiProviders,
          configuredTtsProviders,
          aiProviderMeta: getAllAiProviderClientMeta(),
          ttsProviderMeta: getAllTtsProviderClientMeta(),
          aiSystemProviders,
        }}
        testable={{
          aiProviders: testable.ai,
          ttsProviders: testable.tts,
          sttProviders: testable.stt,
        }}
      />
    </>
  );
}
