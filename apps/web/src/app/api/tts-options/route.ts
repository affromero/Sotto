import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listByokProviders } from '@/lib/byok';
import { getAllProviderMeta, getProviderMeta } from '@/lib/providers/tts-registry';
import { getFreeTierConfig } from '@/lib/free-tier-config';

const QUALITY_BADGES: Record<string, string> = {
  standard: 'Standard',
  premium: 'Premium',
  ultra: 'Ultra',
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const byokKeys = await listByokProviders(session.user.id);
  const validProviderIds = byokKeys.filter((k) => k.isValid).map((k) => k.provider);

  // No BYOK TTS keys → return free tier option as read-only
  if (validProviderIds.length === 0) {
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

  // Build combined provider:model options
  interface TtsOption {
    id: string;
    displayName: string;
    badge?: string;
    group?: string;
  }

  const options: TtsOption[] = [
    { id: 'auto', displayName: 'Auto', badge: 'Best available' },
  ];

  for (const providerId of validProviderIds) {
    const allProviders = getAllProviderMeta();
    const meta = allProviders.find((p) => p.id === providerId);
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
