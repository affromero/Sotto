import { prisma } from './prisma';
import { getFreeTierConfig, type ProviderAllocation } from './free-tier-config';
import { getProviderMeta, compareQuality, type TtsProviderId } from './providers/tts-registry';
import { getAiProviderMeta, type AiProviderId } from './providers/ai-registry';

const AI_TIER_RANK: Record<string, number> = { best: 0, balanced: 1, fast: 2 };

/** Platform TTS API key env var mapping */
const TTS_PLATFORM_KEY_ENVS: Record<string, string> = {
  elevenlabs: 'ELEVENLABS_API_KEY',
  openai: 'OPENAI_API_KEY',
  playht: 'PLAYHT_API_KEY',
  cartesia: 'CARTESIA_API_KEY',
  hume: 'HUME_API_KEY',
  fal: 'FAL_KEY',
  replicate: 'REPLICATE_API_TOKEN',
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
 * provider with remaining quota. Falls back to legacy single-provider config
 * when no allocations exist.
 */
export async function selectFreeTierProviders(userId: string): Promise<SelectedFreeTierProviders> {
  const config = await getFreeTierConfig();

  // No allocations → legacy single-provider mode
  if (config.ttsAllocations.length === 0 && config.aiAllocations.length === 0) {
    return {
      aiProvider: config.aiProvider,
      aiModel: config.aiModel,
      aiQuota: config.generationLimit,
      ttsProvider: config.ttsProvider,
      ttsModel: config.ttsModel,
      ttsQuota: config.generationLimit,
    };
  }

  // Fetch user's per-provider usage
  const usageRows = await prisma.freeProviderUsage.findMany({
    where: { userId },
    select: { category: true, provider: true, used: true },
  });
  const usageMap = new Map(usageRows.map((r) => [`${r.category}:${r.provider}`, r.used]));

  // Select TTS provider: filter to remaining quota, sort by quality tier (highest first)
  const selectedTts = selectTtsProvider(config.ttsAllocations, usageMap, config);

  // Select AI provider: filter to remaining quota, sort by model tier (best first)
  const selectedAi = selectAiProvider(config.aiAllocations, usageMap, config);

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
  config: { ttsProvider: string; ttsModel: string; generationLimit: number }
): { provider: string; model: string; quota: number } {
  if (allocations.length === 0) {
    return { provider: config.ttsProvider, model: config.ttsModel, quota: config.generationLimit };
  }

  // Filter to allocations with remaining quota AND a platform API key available
  const available = allocations
    .filter((a) => {
      const used = usageMap.get(`tts:${a.provider}`) ?? 0;
      if (used >= a.quota) return false;
      const envVar = TTS_PLATFORM_KEY_ENVS[a.provider];
      return envVar ? !!process.env[envVar] : false;
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

  // All allocations exhausted — fall back to legacy
  return { provider: config.ttsProvider, model: config.ttsModel, quota: config.generationLimit };
}

function selectAiProvider(
  allocations: ProviderAllocation[],
  usageMap: Map<string, number>,
  config: { aiProvider: string; aiModel: string; generationLimit: number }
): { provider: string; model: string; quota: number } {
  if (allocations.length === 0) {
    return { provider: config.aiProvider, model: config.aiModel, quota: config.generationLimit };
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

  // All allocations exhausted — fall back to legacy
  return { provider: config.aiProvider, model: config.aiModel, quota: config.generationLimit };
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
