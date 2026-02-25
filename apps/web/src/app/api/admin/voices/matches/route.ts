import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { z } from 'zod';

import { errorResponse } from '@/lib/api-response';
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
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
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = resolveMatchSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { matchId, resolution } = parsed.data;

  const match = await prisma.voiceSimilarityMatch.findUnique({
    where: { id: matchId },
    select: { blockedVoiceId: true },
  });

  if (!match) {
    return errorResponse('Match not found', 404);
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
