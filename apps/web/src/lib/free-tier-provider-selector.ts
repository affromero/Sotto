import { prisma } from './prisma';
import { getAutoModelConfig, type PlanModelConfig, type ProviderAllocation } from './auto-model-config';
import { getProviderMeta, compareQuality, type TtsProviderId } from './providers/tts-registry';
import { getAiProviderMeta, type AiProviderId } from './providers/ai-registry';
import { supportsLanguage, getDefaultModelForLanguage } from './tts-language-support';

const AI_TIER_RANK: Record<string, number> = { best: 0, balanced: 1, fast: 2 };

/** Platform TTS API key env var mapping */
const TTS_PLATFORM_KEY_ENVS: Record<string, string> = {
  elevenlabs: 'ELEVENLABS_API_KEY',
  openai: 'OPENAI_API_KEY',
  cartesia: 'CARTESIA_API_KEY',
  hume: 'HUME_API_KEY',
  fal: 'FAL_KEY',
  replicate: 'REPLICATE_API_TOKEN',
  minimax: 'FAL_KEY',
  mistral: 'MISTRAL_API_KEY',
};

export interface SelectedFreeTierProviders {
  aiProvider: string;
  aiModel: string;
  aiQuota: number;
  ttsProvider: string;
  ttsModel: string;
  ttsQuota: number;
}

/**
 * Select the best available free tier providers for a user.
 *
 * When per-provider allocations are configured, picks the highest-quality
 * provider with remaining quota. Otherwise uses the configured free-tier
 * defaults from AutoModelConfig.
 */
export async function selectFreeTierProviders(userId: string, language?: string | null): Promise<SelectedFreeTierProviders> {
  const config = await getAutoModelConfig();
  const autoFree = config.free;

  // No allocations -> use configured free-tier defaults for providers and quotas.
  if (config.ttsAllocations.length === 0 && config.aiAllocations.length === 0) {
    // When language is set, check if the auto-selected TTS model supports it
    let ttsModel = autoFree.ttsModel;
    if (language && !supportsLanguage(autoFree.ttsProvider as TtsProviderId, ttsModel, language)) {
      const compatible = getDefaultModelForLanguage(autoFree.ttsProvider as TtsProviderId, language, ttsModel);
      if (compatible) ttsModel = compatible;
    }
    return {
      aiProvider: autoFree.aiProvider,
      aiModel: autoFree.aiModel,
      aiQuota: config.dailyGenerationLimit,
      ttsProvider: autoFree.ttsProvider,
      ttsModel,
      ttsQuota: config.dailyGenerationLimit,
    };
  }

  // Fetch user's per-provider usage
  const usageRows = await prisma.freeProviderUsage.findMany({
    where: { userId },
    select: { category: true, provider: true, used: true },
  });
  const usageMap = new Map(usageRows.map((r) => [`${r.category}:${r.provider}`, r.used]));

  // Select TTS provider: filter to remaining quota, sort by quality tier (highest first)
  const selectedTts = selectTtsProvider(config.ttsAllocations, usageMap, config, autoFree, language);

  // Select AI provider: filter to remaining quota, sort by model tier (best first)
  const selectedAi = selectAiProvider(config.aiAllocations, usageMap, config, autoFree);

  return {
    aiProvider: selectedAi.provider,
    aiModel: selectedAi.model,
    aiQuota: selectedAi.quota,
    ttsProvider: selectedTts.provider,
    ttsModel: selectedTts.model,
    ttsQuota: selectedTts.quota,
  };
}

function selectTtsProvider(
  allocations: ProviderAllocation[],
  usageMap: Map<string, number>,
  config: { dailyGenerationLimit: number },
  autoFree: PlanModelConfig,
  language?: string | null,
): { provider: string; model: string; quota: number } {
  if (allocations.length === 0) {
    return { provider: autoFree.ttsProvider, model: autoFree.ttsModel, quota: config.dailyGenerationLimit };
  }

  // Filter to allocations with remaining quota, a platform API key, and language support
  const available = allocations
    .filter((a) => {
      const used = usageMap.get(`tts:${a.provider}`) ?? 0;
      if (used >= a.quota) return false;
      const envVar = TTS_PLATFORM_KEY_ENVS[a.provider];
      if (!envVar || !process.env[envVar]) return false;
      // When language is set, only include allocations whose model supports it
      if (language && !supportsLanguage(a.provider as TtsProviderId, a.model, language)) return false;
      return true;
    })
    .sort((a, b) => {
      // Sort by quality tier (highest first) using compareQuality from tts-registry
      try {
        const metaA = getProviderMeta(a.provider as TtsProviderId);
        const metaB = getProviderMeta(b.provider as TtsProviderId);
        return compareQuality(metaA, metaB);
      } catch {
        return 0;
      }
    });

  if (available.length > 0) {
    return { provider: available[0].provider, model: available[0].model, quota: available[0].quota };
  }

  // All allocations exhausted -> use configured free-tier default, respecting language.
  let defaultModel = autoFree.ttsModel;
  if (language && !supportsLanguage(autoFree.ttsProvider as TtsProviderId, defaultModel, language)) {
    const compatible = getDefaultModelForLanguage(autoFree.ttsProvider as TtsProviderId, language, defaultModel);
    if (compatible) defaultModel = compatible;
  }
  return { provider: autoFree.ttsProvider, model: defaultModel, quota: config.dailyGenerationLimit };
}

function selectAiProvider(
  allocations: ProviderAllocation[],
  usageMap: Map<string, number>,
  config: { dailyGenerationLimit: number },
  autoFree: PlanModelConfig
): { provider: string; model: string; quota: number } {
  if (allocations.length === 0) {
    return { provider: autoFree.aiProvider, model: autoFree.aiModel, quota: config.dailyGenerationLimit };
  }

  // Filter to allocations with remaining quota
  const available = allocations
    .filter((a) => {
      const used = usageMap.get(`ai:${a.provider}`) ?? 0;
      return used < a.quota;
    })
    .sort((a, b) => {
      // Sort by model tier: best (0) → balanced (1) → fast (2)
      const tierA = getModelTier(a.provider, a.model);
      const tierB = getModelTier(b.provider, b.model);
      return (AI_TIER_RANK[tierA] ?? 99) - (AI_TIER_RANK[tierB] ?? 99);
    });

  if (available.length > 0) {
    return { provider: available[0].provider, model: available[0].model, quota: available[0].quota };
  }

  // All allocations exhausted -> use configured free-tier default.
  return { provider: autoFree.aiProvider, model: autoFree.aiModel, quota: config.dailyGenerationLimit };
}

function getModelTier(provider: string, modelId: string): string {
  try {
    const meta = getAiProviderMeta(provider as AiProviderId);
    const model = meta.models.find((m) => m.id === modelId);
    return model?.tier ?? 'fast';
  } catch {
    return 'fast';
  }
}
