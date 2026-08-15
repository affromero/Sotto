import { auth } from '@/lib/auth';
import { getAutoModelConfig, resolveDisabledSystemAiProviders } from '@/lib/auto-model-config';
import { listAiProviders, listByokProviders } from '@/lib/byok';
import { getAgentStatus } from '@/lib/agent-availability';
import { credentialReloadAvailable } from '@/lib/agent-credentials';
import { getAgentModelOffering } from '@/lib/agent-models';
import { getAllAiProviderClientMeta, getAllAiProviderMeta } from '@/lib/providers/ai-registry';
import { getAllProviderMeta, getAllTtsProviderClientMeta } from '@/lib/providers/tts-registry';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';
import { getTestableProviders } from '@/lib/admin/testable-providers';
import { ProvidersTabs } from './ProvidersTabs';
import styles from '../../adminTheme.styles';

export const metadata = { title: 'Providers & models · Sotto admin' };

export default async function AdminProvidersPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [config, testable, byokKeys, aiKeys, claudeStatus, codexStatus] = await Promise.all([
    getAutoModelConfig(),
    getTestableProviders(userId),
    listByokProviders(userId),
    listAiProviders(userId),
    getAgentStatus('claude-code'),
    getAgentStatus('codex'),
  ]);
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
