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

  const [user, catalogVoices, userClones, approvedRequests, allowlistEntries] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: authResult.userId },
      select: { stripeAccountId: true, stripeOnboarded: true },
    }),
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
        requestable: true,
        priceInCents: true,
        verificationStatus: true,
        createdAt: true,
        voicePurchases: {
          where: { status: 'captured' },
          select: { amountCents: true, platformFeeCents: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.voiceRequest.findMany({
      where: {
        requesterId: authResult.userId,
        status: 'APPROVED',
        voiceClone: {
          verificationStatus: { in: ['VERIFIED', 'ADMIN_VERIFIED'] },
        },
      },
      select: {
        voiceClone: {
          select: {
            id: true,
            name: true,
            externalVoiceId: true,
            sourceType: true,
            provider: true,
            createdAt: true,
            user: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.voiceAllowlist.findMany({
      where: {
        allowedUserId: authResult.userId,
        voiceClone: {
          verificationStatus: { in: ['VERIFIED', 'ADMIN_VERIFIED'] },
        },
      },
      select: {
        voiceClone: {
          select: {
            id: true,
            name: true,
            externalVoiceId: true,
            sourceType: true,
            provider: true,
            createdAt: true,
            user: { select: { id: true, name: true } },
          },
        },
      },
    }),
  ]);

  // Enrich user clones with earnings
  const enrichedClones = userClones.map((clone) => {
    const totalEarningsCents = clone.voicePurchases.reduce(
      (sum, p) => sum + (p.amountCents - p.platformFeeCents),
      0
    );
    return {
      id: clone.id,
      name: clone.name,
      externalVoiceId: clone.externalVoiceId,
      sourceType: clone.sourceType,
      provider: clone.provider,
      description: clone.description,
      requestable: clone.requestable,
      priceInCents: clone.priceInCents,
      verificationStatus: clone.verificationStatus,
      createdAt: clone.createdAt,
      salesCount: clone.voicePurchases.length,
      totalEarningsCents,
    };
  });

  // Merge approved-request voices + allowlisted voices, dedup by externalVoiceId
  const seenVoiceIds = new Set<string>();
  const sharedVoices: Array<{
    id: string;
    name: string;
    externalVoiceId: string;
    sourceType: string;
    provider: string;
    createdAt: Date;
    owner: { id: string; name: string | null };
  }> = [];

  for (const r of approvedRequests) {
    if (!seenVoiceIds.has(r.voiceClone.externalVoiceId)) {
      seenVoiceIds.add(r.voiceClone.externalVoiceId);
      sharedVoices.push({
        id: r.voiceClone.id,
        name: r.voiceClone.name,
        externalVoiceId: r.voiceClone.externalVoiceId,
        sourceType: r.voiceClone.sourceType,
        provider: r.voiceClone.provider,
        createdAt: r.voiceClone.createdAt,
        owner: r.voiceClone.user,
      });
    }
  }

  for (const a of allowlistEntries) {
    if (!seenVoiceIds.has(a.voiceClone.externalVoiceId)) {
      seenVoiceIds.add(a.voiceClone.externalVoiceId);
      sharedVoices.push({
        id: a.voiceClone.id,
        name: a.voiceClone.name,
        externalVoiceId: a.voiceClone.externalVoiceId,
        sourceType: a.voiceClone.sourceType,
        provider: a.voiceClone.provider,
        createdAt: a.voiceClone.createdAt,
        owner: a.voiceClone.user,
      });
    }
  }

  return NextResponse.json({
    poolVoices: catalogVoices.map((v) => ({
      id: v.id,
      name: v.name,
      gender: v.gender ?? '',
      accent: v.accent ?? '',
      ageRange: v.age ?? '',
      character: v.description ?? '',
    })),
    userClones: enrichedClones,
    sharedVoices,
    maxVoiceClones: LIMITS.maxVoiceClones,
    stripeOnboarded: user.stripeOnboarded,
    stripeAccountId: user.stripeAccountId,
  });
}
