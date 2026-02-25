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
  kittentts: 'KITTENTTS_URL',
};

interface TtsOption {
  id: string;
  displayName: string;
  badge?: string;
  group?: string;
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
        { id: 'auto', displayName: 'Auto', badge: 'Best available' },
      ];

      for (const meta of getAllProviderMeta()) {
        const envVar = PLATFORM_TTS_ENV[meta.id];
        if (!envVar || !process.env[envVar]) continue;

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
    { id: 'auto', displayName: 'Auto', badge: 'Best available' },
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
