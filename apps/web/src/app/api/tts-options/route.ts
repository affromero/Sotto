import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { listByokProviders } from '@/lib/byok';
import { getAllProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { getAutoModelConfig, resolveTtsIncludedModels } from '@/lib/auto-model-config';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
const QUALITY_BADGES: Record<string, string> = {
  standard: 'Standard',
  premium: 'Premium',
  ultra: 'Ultra',
};

const TIER_GROUP_LABELS: Record<string, string> = {
  standard: 'Standard',
  premium: 'High quality',
  ultra: 'Studio quality',
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
  kittentts: 'KITTENTTS_URL',
};

function hasPlatformKey(providerId: TtsProviderId): boolean {
  if (providerId === 'kittentts') {
    return !!process.env.KITTENTTS_URL;
  }
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
    // Admins see all platform-configured TTS providers (from env vars)
    if (isAdmin) {
      const options: TtsOption[] = [
        { id: 'auto', displayName: 'Auto', badge: 'Best available', hint: 'Picks the best voice and provider based on your podcast\u2019s topic, tone, and speakers' },
      ];

      for (const meta of getAllProviderMeta()) {
        if (!hasPlatformKey(meta.id)) continue;

        const isKitten = meta.id === 'kittentts';
        for (const model of meta.models) {
          options.push({
            id: `${meta.id}:${model.id}`,
            displayName: `${meta.displayName} ${model.displayName}`,
            badge: QUALITY_BADGES[model.tier],
            group: isKitten ? 'KittenTTS (Platform)' : (TIER_GROUP_LABELS[model.tier] ?? model.tier),
            hint: isKitten ? undefined : meta.displayName,
          });
        }
      }

      return NextResponse.json({ readOnly: false, options });
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

      const isKitten = meta.id === 'kittentts';
      for (const model of meta.models) {
        const compositeId = `${meta.id}:${model.id}`;
        if (!proSet.has(compositeId)) continue;

        options.push({
          id: compositeId,
          displayName: `${meta.displayName} ${model.displayName}`,
          badge: QUALITY_BADGES[model.tier],
          group: isKitten ? 'KittenTTS (Platform)' : (TIER_GROUP_LABELS[model.tier] ?? model.tier),
          hint: isKitten ? undefined : meta.displayName,
          requiredPlan: freeSet.has(compositeId) ? 'FREE' : 'PRO',
        });
      }
    }

    return NextResponse.json({ readOnly: false, userPlan, isByok: false, options });
  }

  // BYOK keys present — show models for every valid provider
  const options: TtsOption[] = [
    { id: 'auto', displayName: 'Auto', badge: 'Best available', hint: 'Picks the best voice and provider based on your podcast\u2019s topic, tone, and speakers' },
  ];

  for (const providerId of validProviderIds) {
    const meta = getAllProviderMeta().find((p) => p.id === providerId);
    if (!meta) continue;

    for (const model of meta.models) {
      options.push({
        id: `${meta.id}:${model.id}`,
        displayName: `${meta.displayName} ${model.displayName}`,
        badge: QUALITY_BADGES[model.tier],
        group: TIER_GROUP_LABELS[model.tier] ?? model.tier,
        hint: meta.displayName,
      });
    }
  }

  return NextResponse.json({ readOnly: false, options });
}
