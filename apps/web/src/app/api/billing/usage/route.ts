import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { LIMITS, FREE_TIER_MAX_DURATION_MINUTES } from '@/lib/stripe';
import { listByokProviders, listAiProviders } from '@/lib/byok';
import { getFreeTierStatus } from '@/lib/generation-gate';

export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [podcastCount, ttsKeys, aiKeys, freeTier] = await Promise.all([
      prisma.podcast.count({ where: { userId: session.user.id } }),
      listByokProviders(session.user.id),
      listAiProviders(session.user.id),
      getFreeTierStatus(session.user.id),
    ]);

    return NextResponse.json({
      tier: 'FREE',
      podcastCount,
      byok: {
        ai: aiKeys.map((k) => ({ provider: k.provider, isValid: k.isValid })),
        tts: ttsKeys.map((k) => ({ provider: k.provider, isValid: k.isValid })),
      },
      freeTier: {
        used: freeTier.freeGenerationsUsed,
        limit: freeTier.freeGenerationsLimit,
        remaining: freeTier.freeGenerationsRemaining,
        isByokUser: freeTier.isByokUser,
        aiQuotas: freeTier.aiQuotas,
        ttsQuotas: freeTier.ttsQuotas,
      },
      limits: {
        maxDurationMinutes: freeTier.isByokUser ? LIMITS.maxDurationMinutes : FREE_TIER_MAX_DURATION_MINUTES,
        maxVoiceClones: LIMITS.maxVoiceClones,
        canDownload: LIMITS.canDownload,
        canMakePrivate: freeTier.isByokUser,
        canExportPdf: LIMITS.canExportPdf,
        hasPremiumSfx: LIMITS.hasPremiumSfx,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch usage';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
