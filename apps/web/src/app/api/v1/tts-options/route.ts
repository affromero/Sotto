import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { listByokProviders } from '@/lib/byok';
import { getAllProviderMeta } from '@/lib/providers/tts-registry';
import { getAutoModelConfig, resolveTtsIncludedModels } from '@/lib/auto-model-config';

import { errorResponse } from '@/lib/api-response';
import { getSiteConfig } from '@/lib/site-config';

const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' };
const QUALITY_BADGES: Record<string, string> = {
  standard: 'Standard',
  premium: 'Premium',
  ultra: 'Ultra',
};

/** Sort options: providers alphabetically by group, models alphabetically within each provider. */
function sortOptions(options: TtsOption[]): TtsOption[] {
  return [...options].sort(
    (a, b) =>
      (a.group ?? '').localeCompare(b.group ?? '') || a.displayName.localeCompare(b.displayName)
  );
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

  const [byokKeys, autoConfig, siteConfig] = await Promise.all([
    listByokProviders(authResult.userId, true),
    getAutoModelConfig(),
    getSiteConfig(),
  ]);
  const validProviderIds = new Set(byokKeys.filter((k) => k.isValid).map((k) => k.provider));
  if (
    (siteConfig.ttsProvider === 'local' || siteConfig.ttsProvider === 'kokoro') &&
    siteConfig.ttsBaseUrl
  )
    validProviderIds.add(siteConfig.ttsProvider);
  const includedModelIds = new Set(resolveTtsIncludedModels(autoConfig));
  const optionsById = new Map<string, TtsOption>();

  for (const providerId of validProviderIds) {
    const meta = getAllProviderMeta().find((p) => p.id === providerId);
    if (!meta) continue;
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

  return NextResponse.json(
    {
      readOnly: false,
      hasCredential: validProviderIds.size > 0,
      options: sortOptions([...optionsById.values()]),
    },
    { headers: CACHE_HEADERS }
  );
}
