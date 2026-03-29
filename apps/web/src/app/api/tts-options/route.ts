import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { listByokProviders } from '@/lib/byok';
import { getAllProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { getAutoModelConfig, resolveTtsIncludedModels } from '@/lib/auto-model-config';
import { prisma } from '@/lib/prisma';

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
  return [...options].sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.displayName.localeCompare(b.displayName));
}

function hasPlatformKey(providerId: TtsProviderId): boolean {
  const envVar = PLATFORM_TTS_ENV[providerId];
  return envVar ? !!process.env[envVar] : false;
}

interface TtsOption {
  id: string;
  displayName: string;
  badge?: string;
  group?: string;
  hint?: string;
  requiredPlan?: 'FREE' | 'PRO';
}

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: authResult.userId },
    select: { plan: true, role: true },
  });
  const isAdmin = user?.role === 'ADMIN';
  const byokKeys = await listByokProviders(authResult.userId);
  const validProviderIds = byokKeys.filter((k) => k.isValid).map((k) => k.provider);

  // No BYOK TTS keys
  if (validProviderIds.length === 0) {
    // Admins: respect adminViewMode toggle
    if (isAdmin) {
      const autoConfig = await getAutoModelConfig();
      const proView = autoConfig.adminViewMode === 'PRO';
      const options: TtsOption[] = [];

      if (!proView) {
        options.push({ id: 'auto', displayName: 'Auto', badge: 'Best available', hint: 'Picks the best voice and provider based on your podcast\u2019s topic, tone, and speakers' });
      }

      if (proView) {
        const { freeTtsModels, proTtsModels } = resolveTtsIncludedModels(autoConfig);
        const freeSet = new Set(freeTtsModels);
        const proSet = new Set(proTtsModels);

        for (const meta of getAllProviderMeta()) {
          if (!hasPlatformKey(meta.id)) continue;
          for (const model of meta.models) {
            const compositeId = `${meta.id}:${model.id}`;
            if (!proSet.has(compositeId)) continue;
            options.push({
              id: compositeId,
              displayName: `${meta.displayName} ${model.displayName}`,
              badge: QUALITY_BADGES[model.tier],
              group: meta.displayName,
              hint: meta.displayName,
              requiredPlan: freeSet.has(compositeId) ? 'FREE' : 'PRO',
            });
          }
        }
      } else {
        for (const meta of getAllProviderMeta()) {
          if (!hasPlatformKey(meta.id)) continue;
          for (const model of meta.models) {
            options.push({
              id: `${meta.id}:${model.id}`,
              displayName: `${meta.displayName} ${model.displayName}`,
              badge: QUALITY_BADGES[model.tier],
              group: meta.displayName,
              hint: meta.displayName,
            });
          }
        }
      }

      return NextResponse.json({ readOnly: false, adminViewMode: autoConfig.adminViewMode, options: sortOptions(options) }, { headers: CACHE_HEADERS });
    }

    // Non-admins: show included TTS models with plan gating
    const userPlan = (user?.plan ?? 'FREE') as 'FREE' | 'PRO';
    const autoConfig = await getAutoModelConfig();
    const { freeTtsModels, proTtsModels } = resolveTtsIncludedModels(autoConfig);
    const freeSet = new Set(freeTtsModels);
    const proSet = new Set(proTtsModels);

    const options: TtsOption[] = [];

    for (const meta of getAllProviderMeta()) {
      if (!hasPlatformKey(meta.id)) continue;

      for (const model of meta.models) {
        const compositeId = `${meta.id}:${model.id}`;
        if (!proSet.has(compositeId)) continue;

        options.push({
          id: compositeId,
          displayName: `${meta.displayName} ${model.displayName}`,
          badge: QUALITY_BADGES[model.tier],
          group: meta.displayName,
          hint: meta.displayName,
          requiredPlan: freeSet.has(compositeId) ? 'FREE' : 'PRO',
        });
      }
    }

    return NextResponse.json({ readOnly: false, userPlan, isByok: false, options: sortOptions(options) }, { headers: CACHE_HEADERS });
  }

  // BYOK keys present — filter through AutoModelConfig (same as non-BYOK)
  // Admins in free view bypass the filter and see all models
  const autoConfig = await getAutoModelConfig();
  const adminFreeView = isAdmin && autoConfig.adminViewMode !== 'PRO';

  const options: TtsOption[] = [
    { id: 'auto', displayName: 'Auto', badge: 'Best available', hint: 'Picks the best voice and provider based on your podcast\u2019s topic, tone, and speakers' },
  ];

  if (adminFreeView) {
    // Admin free view: show all BYOK provider models unfiltered
    for (const providerId of validProviderIds) {
      const meta = getAllProviderMeta().find((p) => p.id === providerId);
      if (!meta) continue;
      for (const model of meta.models) {
        options.push({
          id: `${meta.id}:${model.id}`,
          displayName: `${meta.displayName} ${model.displayName}`,
          badge: QUALITY_BADGES[model.tier],
          group: meta.displayName,
          hint: meta.displayName,
        });
      }
    }
  } else {
    // Everyone else (including admin PRO view): filter to AutoModelConfig included models
    const { freeTtsModels, proTtsModels } = resolveTtsIncludedModels(autoConfig);
    const freeSet = new Set(freeTtsModels);
    const proSet = new Set(proTtsModels);

    for (const providerId of validProviderIds) {
      const meta = getAllProviderMeta().find((p) => p.id === providerId);
      if (!meta) continue;
      for (const model of meta.models) {
        const compositeId = `${meta.id}:${model.id}`;
        if (!proSet.has(compositeId)) continue;
        options.push({
          id: compositeId,
          displayName: `${meta.displayName} ${model.displayName}`,
          badge: QUALITY_BADGES[model.tier],
          group: meta.displayName,
          hint: meta.displayName,
          requiredPlan: freeSet.has(compositeId) ? 'FREE' : 'PRO',
        });
      }
    }
  }

  return NextResponse.json({ readOnly: false, isByok: true, options: sortOptions(options) }, { headers: CACHE_HEADERS });
}
