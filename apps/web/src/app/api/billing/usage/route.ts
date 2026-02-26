import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { LIMITS } from '@/lib/stripe';
import { listByokProviders, listAiProviders, hasByokKey } from '@/lib/byok';
import { getFreeTierStatus } from '@/lib/generation-gate';
import { getTierFeatures } from '@/lib/tier-features';

import { errorResponse } from '@/lib/api-response';
export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    const [podcastCount, ttsKeys, aiKeys, freeTier, user, isByok] = await Promise.all([
      prisma.podcast.count({ where: { userId: session.user.id } }),
      listByokProviders(session.user.id),
      listAiProviders(session.user.id),
      getFreeTierStatus(session.user.id),
      prisma.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: { plan: true, role: true },
      }),
      hasByokKey(session.user.id),
    ]);

    const features = getTierFeatures(user.plan as 'FREE' | 'PRO', isByok, user.role);

    return NextResponse.json({
      tier: user.plan,
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
        maxDurationMinutes: isFinite(features.maxDurationMinutes) ? features.maxDurationMinutes : 9999,
        maxVoiceClones: LIMITS.maxVoiceClones,
        canMakePrivate: features.privateAllowed,
        canExportPdf: LIMITS.canExportPdf,
        hasPremiumSfx: LIMITS.hasPremiumSfx,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch usage';
    return errorResponse(message, 500);
  }
}
