import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listByokProviders } from '@/lib/byok';
import { getAllProviderMeta, getProviderMeta, type TtsProviderId } from '@/lib/providers/tts-registry';
import { getFreeTierConfig } from '@/lib/free-tier-config';

import { errorResponse } from '@/lib/api-response';
const QUALITY_BADGES: Record<string, string> = {
  standard: 'Standard',
  premium: 'Premium',
  ultra: 'Ultra',
};

// Env var names for each platform-level TTS provider key
const PLATFORM_TTS_ENV: Partial<Record<TtsProviderId, string>> = {
  elevenlabs: 'ELEVENLABS_API_KEY',
  openai: 'OPENAI_API_KEY',
  playht: 'PLAYHT_API_KEY',
  cartesia: 'CARTESIA_API_KEY',
  hume: 'HUME_API_KEY',
  fal: 'FAL_KEY',
  replicate: 'REPLICATE_API_TOKEN',
  kittentts: 'KITTENTTS_URL',
};

// PlayHT requires both API key and user ID
function hasPlatformKey(providerId: TtsProviderId): boolean {
  if (providerId === 'playht') {
    return !!(process.env.PLAYHT_API_KEY && process.env.PLAYHT_USER_ID);
  }
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
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const isAdmin = session.user.role === 'ADMIN';
  const byokKeys = await listByokProviders(session.user.id);
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

        for (const model of meta.models) {
          options.push({
            id: `${meta.id}:${model.id}`,
            displayName: `${meta.displayName} ${model.displayName}`,
            badge: QUALITY_BADGES[model.tier],
            group: meta.displayName,
          });
        }
      }

      return NextResponse.json({ readOnly: false, options });
    }

    // Non-admins: single free-tier model, read-only
    const config = await getFreeTierConfig();
    const provider = getProviderMeta(config.ttsProvider);
    const model = provider.models.find((m) => m.id === config.ttsModel);

    return NextResponse.json({
      readOnly: true,
      options: model
        ? [
            {
              id: `${provider.id}:${model.id}`,
              displayName: `${provider.displayName} ${model.displayName}`,
              badge: QUALITY_BADGES[model.tier],
            },
          ]
        : [],
    });
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
        group: meta.displayName,
      });
    }
  }

  return NextResponse.json({ readOnly: false, options });
}
