import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { listByokProviders } from '@/lib/byok';
import { getAllProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { getAutoModelConfig, resolveTtsIncludedModels } from '@/lib/auto-model-config';

import { errorResponse } from '@/lib/api-response';

const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' };
const QUALITY_BADGES: Record<string, string> = {
  standard: 'Standard',
  premium: 'Premium',
  ultra: 'Ultra',
};

// Env var names for each platform-level TTS provider key
const PLATFORM_TTS_ENV: Partial<Record<TtsProviderId, string>> = {
  elevenlabs: 'ELEVENLABS_API_KEY',
  openai: 'OPENAI_API_KEY',
  cartesia: 'CARTESIA_API_KEY',
  hume: 'HUME_API_KEY',
  fal: 'FAL_KEY',
  replicate: 'REPLICATE_API_TOKEN',
  minimax: 'FAL_KEY',
  mistral: 'MISTRAL_API_KEY',
};

/** Sort options: providers alphabetically by group, models alphabetically within each provider. */
function sortOptions(options: TtsOption[]): TtsOption[] {
  return [...options].sort(
    (a, b) =>
      (a.group ?? '').localeCompare(b.group ?? '') || a.displayName.localeCompare(b.displayName)
  );
}

function hasPlatformKey(providerId: TtsProviderId): boolean {
  // Kokoro is keyless and local — it is "available" when the sidecar URL is set.
  if (providerId === 'kokoro') return !!process.env.TTS_BASE_URL?.trim();
  const envVar = PLATFORM_TTS_ENV[providerId];
  return envVar ? !!process.env[envVar] : false;
}

interface TtsOption {
  id: string;
  displayName: string;
  badge?: string;
  group?: string;
  hint?: string;
  supportedLanguages?: string[];
}

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const [byokKeys, autoConfig] = await Promise.all([
    listByokProviders(authResult.userId),
    getAutoModelConfig(),
  ]);
  const validProviderIds = byokKeys.filter((k) => k.isValid).map((k) => k.provider);
  const includedModelIds = new Set(resolveTtsIncludedModels(autoConfig));
  const optionsById = new Map<string, TtsOption>();

  for (const meta of getAllProviderMeta()) {
    if (!hasPlatformKey(meta.id)) continue;
    for (const model of meta.models) {
      const compositeId = `${meta.id}:${model.id}`;
      if (!includedModelIds.has(compositeId)) continue;
      optionsById.set(compositeId, {
        id: compositeId,
        displayName: `${meta.displayName} ${model.displayName}`,
        badge: QUALITY_BADGES[model.tier],
        group: meta.displayName,
        hint: meta.displayName,
        supportedLanguages: [...model.supportedLanguages],
      });
    }
  }

  for (const providerId of validProviderIds) {
    const meta = getAllProviderMeta().find((p) => p.id === providerId);
    if (!meta) continue;
    for (const model of meta.models) {
      const compositeId = `${meta.id}:${model.id}`;
      optionsById.set(compositeId, {
        id: compositeId,
        displayName: `${meta.displayName} ${model.displayName}`,
        badge: QUALITY_BADGES[model.tier],
        group: meta.displayName,
        hint: meta.displayName,
        supportedLanguages: [...model.supportedLanguages],
      });
    }
  }

  return NextResponse.json(
    { readOnly: false, isByok: validProviderIds.length > 0, options: sortOptions([...optionsById.values()]) },
    { headers: CACHE_HEADERS }
  );
}
