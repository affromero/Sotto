import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { getVoiceCatalog } from '@/lib/voice-catalog';
import { isValidProviderId, type TtsProviderId } from '@/lib/providers/tts-registry';
import { LIMITS } from '@/lib/stripe';
import { errorResponse } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const providerParam = request.nextUrl.searchParams.get('provider');
  let provider: TtsProviderId = 'elevenlabs';
  if (providerParam) {
    if (!isValidProviderId(providerParam)) {
      return errorResponse('Invalid provider', 400);
    }
    provider = providerParam;
  }

  const [catalogVoices, userClones] = await Promise.all([
    getVoiceCatalog(provider),
    prisma.voiceClone.findMany({
      where: { userId: authResult.userId },
      select: {
        id: true,
        name: true,
        externalVoiceId: true,
        sourceType: true,
        provider: true,
        description: true,
        verificationStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return NextResponse.json({
    poolVoices: catalogVoices.map((v) => ({
      id: v.id,
      name: v.name,
      gender: v.gender ?? '',
      accent: v.accent ?? '',
      ageRange: v.age ?? '',
      character: v.description ?? '',
    })),
    userClones,
    maxVoiceClones: LIMITS.maxVoiceClones,
  });
}
