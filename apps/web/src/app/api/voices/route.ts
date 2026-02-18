import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { VOICE_POOL } from '@/lib/elevenlabs';
import { LIMITS } from '@/lib/stripe';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [user, userClones, approvedRequests, allowlistEntries] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { stripeAccountId: true, stripeOnboarded: true },
    }),
    prisma.voiceClone.findMany({
      where: { userId: session.user.id },
      select: {
        id: true,
        name: true,
        externalVoiceId: true,
        sourceType: true,
        description: true,
        requestable: true,
        priceInCents: true,
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
        requesterId: session.user.id,
        status: 'APPROVED',
      },
      select: {
        voiceClone: {
          select: {
            id: true,
            name: true,
            externalVoiceId: true,
            sourceType: true,
            createdAt: true,
            user: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.voiceAllowlist.findMany({
      where: {
        allowedUserId: session.user.id,
      },
      select: {
        voiceClone: {
          select: {
            id: true,
            name: true,
            externalVoiceId: true,
            sourceType: true,
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
      description: clone.description,
      requestable: clone.requestable,
      priceInCents: clone.priceInCents,
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
        createdAt: a.voiceClone.createdAt,
        owner: a.voiceClone.user,
      });
    }
  }

  return NextResponse.json({
    poolVoices: VOICE_POOL,
    userClones: enrichedClones,
    sharedVoices,
    maxVoiceClones: LIMITS.maxVoiceClones,
    stripeOnboarded: user.stripeOnboarded,
    stripeAccountId: user.stripeAccountId,
  });
}
