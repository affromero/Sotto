/**
 * admin/testable-providers.ts — builds the list of provider/model rows the admin
 * Model Tester can smoke-test. Only rows backed by a saved credential or an
 * authenticated local agent session are returned.
 */
import { listByokProviders, listAiProviders } from '@/lib/byok';
import { getAllAiProviderMeta } from '@/lib/providers/ai-registry';
import { getAllProviderMeta } from '@/lib/providers/tts-registry';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';
import { getAgentModelOffering } from '@/lib/agent-models';
import { getAgentStatus, type AgentReadiness } from '@/lib/agent-availability';

export type TestableProvider = {
  category: 'ai' | 'tts' | 'stt';
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  tier: string;
  hasLocalSession: boolean;
  hasByokKey: boolean;
  disabled?: boolean;
  disabledReason?: string;
};

export interface TestableProviders {
  ai: TestableProvider[];
  tts: TestableProvider[];
  stt: TestableProvider[];
}

function hasLocalSession(
  category: TestableProvider['category'],
  providerId: string,
  agentReadiness: Record<'claude-code' | 'codex', AgentReadiness>
): boolean {
  if (category === 'ai') {
    switch (providerId) {
      case 'claude-code':
        return agentReadiness['claude-code'] === 'ready';
      case 'codex':
        return agentReadiness.codex === 'ready';
      default:
        return false;
    }
  }
  return false;
}

function hasByokKey(
  category: TestableProvider['category'],
  providerId: string,
  aiSet: Set<string>,
  ttsSet: Set<string>
): boolean {
  if (category === 'ai') return aiSet.has(providerId);
  if (category === 'tts') return ttsSet.has(providerId);
  if (category === 'stt') {
    if (
      providerId === 'openai' ||
      providerId === 'together' ||
      providerId === 'deepgram' ||
      providerId === 'assemblyai'
    ) {
      return aiSet.has(providerId);
    }
    if (providerId === 'elevenlabs') return ttsSet.has('elevenlabs');
  }
  return false;
}

/** Resolve every testable provider/model for the given admin, key-filtered. */
export async function getTestableProviders(userId: string): Promise<TestableProviders> {
  const [aiKeys, ttsKeys, claudeOffering, codexOffering, claudeStatus, codexStatus] =
    await Promise.all([
      listAiProviders(userId, true),
      listByokProviders(userId, true),
      getAgentModelOffering('claude-code'),
      getAgentModelOffering('codex'),
      getAgentStatus('claude-code'),
      getAgentStatus('codex'),
    ]);
  const agentReadiness = {
    'claude-code': claudeStatus.readiness,
    codex: codexStatus.readiness,
  };
  const aiByokSet = new Set(aiKeys.map((k) => k.provider as string));
  const ttsByokSet = new Set(ttsKeys.map((k) => k.provider as string));

  const withKeyFlags = (
    raw: Omit<TestableProvider, 'hasLocalSession' | 'hasByokKey'>[]
  ): TestableProvider[] =>
    raw
      .map((p) => ({
        ...p,
        hasLocalSession: hasLocalSession(p.category, p.providerId, agentReadiness),
        hasByokKey: hasByokKey(p.category, p.providerId, aiByokSet, ttsByokSet),
      }))
      .filter((p) => p.hasLocalSession || p.hasByokKey);

  const ai = withKeyFlags(
    getAllAiProviderMeta().flatMap((p) => {
      const models =
        p.id === 'claude-code'
          ? claudeOffering.models
          : p.id === 'codex'
            ? codexOffering.models
            : p.models;
      return models.map((m) => ({
        category: 'ai' as const,
        providerId: p.id,
        providerName: p.displayName,
        modelId: m.id,
        modelName: m.displayName,
        tier: m.tier,
      }));
    })
  );

  const tts = withKeyFlags(
    getAllProviderMeta().flatMap((p) =>
      p.models.map((m) => ({
        category: 'tts' as const,
        providerId: p.id,
        providerName: p.displayName,
        modelId: m.id,
        modelName: m.displayName,
        tier: m.tier,
      }))
    )
  );

  const stt = withKeyFlags(
    getAllSttProviderMeta().flatMap((p) =>
      p.models.map((m) => ({
        category: 'stt' as const,
        providerId: p.id,
        providerName: p.displayName,
        modelId: m.id,
        modelName: m.displayName,
        tier: m.tier,
      }))
    )
  );

  return { ai, tts, stt };
}
