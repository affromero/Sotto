import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { z } from 'zod';

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const matches = await prisma.voiceSimilarityMatch.findMany({
    where: { resolution: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      similarity: true,
      createdAt: true,
      matchedVoice: {
        select: {
          id: true,
          name: true,
          user: { select: { name: true } },
        },
      },
      blockedVoice: {
        select: {
          id: true,
          name: true,
          user: { select: { name: true } },
        },
      },
    },
  });

  return NextResponse.json({ matches });
}

const resolveMatchSchema = z.object({
  matchId: z.string().min(1),
  resolution: z.enum(['admin_cleared', 'admin_confirmed']),
});

export async function PATCH(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = resolveMatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { matchId, resolution } = parsed.data;

  const match = await prisma.voiceSimilarityMatch.findUnique({
    where: { id: matchId },
    select: { blockedVoiceId: true },
  });

  if (!match) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 });
  }

  await prisma.voiceSimilarityMatch.update({
    where: { id: matchId },
    data: { resolution, resolvedBy: adminId },
  });

  // If admin cleared, unblock the blocked voice
  if (resolution === 'admin_cleared') {
    await prisma.voiceClone.update({
      where: { id: match.blockedVoiceId },
      data: { verificationStatus: 'AWAITING_CHALLENGE' },
    });
  }

  return NextResponse.json({ success: true });
}
