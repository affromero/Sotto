/**
 * admin/testable-providers.ts — builds the list of provider/model rows the admin
 * Model Tester can smoke-test. Only rows with a platform key or the signed-in
 * admin's BYOK key are returned. Shared by /admin/providers and /admin/models.
 */
import { execSync } from 'child_process';
import { listByokProviders, listAiProviders } from '@/lib/byok';
import { getAllAiProviderMeta } from '@/lib/providers/ai-registry';
import { getAllProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { getAllSttProviderMeta } from '@/lib/providers/stt-registry';
import { getPlatformTtsKey } from '@/lib/tts-generation';
import { getAgentModelOptions } from '@/lib/agent-models';

export type TestableProvider = {
  category: 'ai' | 'tts' | 'stt';
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  tier: string;
  hasPlatformKey: boolean;
  hasByokKey: boolean;
  disabled?: boolean;
  disabledReason?: string;
};

export interface TestableProviders {
  ai: TestableProvider[];
  tts: TestableProvider[];
  stt: TestableProvider[];
}

function isCliAvailable(command: string): boolean {
  try {
    execSync(`${command} --version`, { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function hasPlatformKey(category: TestableProvider['category'], providerId: string): boolean {
  if (category === 'ai') {
    switch (providerId) {
      case 'anthropic':
        return !!process.env.ANTHROPIC_API_KEY;
      case 'openai':
        return !!process.env.OPENAI_API_KEY;
      case 'google':
        return !!process.env.GOOGLE_AI_API_KEY;
      case 'claude-code':
        return isCliAvailable('claude');
      case 'codex':
        return isCliAvailable('codex');
      default:
        return false;
    }
  }
  if (category === 'tts') {
    return !!getPlatformTtsKey(providerId as TtsProviderId);
  }
  if (category === 'stt') {
    switch (providerId) {
      case 'openai':
        return !!process.env.OPENAI_API_KEY;
      case 'elevenlabs':
        return !!process.env.ELEVENLABS_API_KEY;
      case 'together':
        return !!process.env.TOGETHER_API_KEY;
      case 'deepgram':
        return !!process.env.DEEPGRAM_API_KEY;
      case 'assemblyai':
        return !!process.env.ASSEMBLYAI_API_KEY;
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
  const [aiKeys, ttsKeys] = await Promise.all([listAiProviders(userId), listByokProviders(userId)]);
  const aiByokSet = new Set(aiKeys.map((k) => k.provider as string));
  const ttsByokSet = new Set(ttsKeys.map((k) => k.provider as string));

  const withKeyFlags = (
    raw: Omit<TestableProvider, 'hasPlatformKey' | 'hasByokKey'>[]
  ): TestableProvider[] =>
    raw
      .map((p) => ({
        ...p,
        hasPlatformKey: hasPlatformKey(p.category, p.providerId),
        hasByokKey: hasByokKey(p.category, p.providerId, aiByokSet, ttsByokSet),
      }))
      .filter((p) => p.hasPlatformKey || p.hasByokKey);

  const ai = withKeyFlags(
    getAllAiProviderMeta().flatMap((p) => {
      const models =
        p.id === 'claude-code' || p.id === 'codex' ? getAgentModelOptions(p.id) : p.models;
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
