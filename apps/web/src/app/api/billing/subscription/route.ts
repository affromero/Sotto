import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { LIMITS } from '@/lib/stripe';
import { listAiProviders, listByokProviders } from '@/lib/byok';
import { getFreeTierStatus } from '@/lib/generation-gate';

import { errorResponse } from '@/lib/api-response';
export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    const [aiKeys, ttsKeys, freeTier, user] = await Promise.all([
      listAiProviders(session.user.id),
      listByokProviders(session.user.id),
      getFreeTierStatus(session.user.id),
      prisma.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: { plan: true },
      }),
    ]);

    return NextResponse.json({
      tier: user.plan,
      status: 'ACTIVE',
      byok: {
        ai: aiKeys.map((k) => ({ provider: k.provider, isValid: k.isValid })),
        tts: ttsKeys.map((k) => ({ provider: k.provider, isValid: k.isValid })),
      },
      freeTier: {
        isByokUser: freeTier.isByokUser,
        aiQuotas: freeTier.aiQuotas,
        ttsQuotas: freeTier.ttsQuotas,
      },
      limits: LIMITS,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch subscription';
    return errorResponse(message, 500);
  }
}
