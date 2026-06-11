import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { errorResponse } from '@/lib/api-response';

type RouteParams = { params: Promise<{ matchId: string }> };

const resolveSchema = z.object({
  action: z.enum(['approve', 'reject']),
  resolution: z.string().max(2000).optional(),
});

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const { matchId } = await params;
  const body = await request.json();
  const parsed = resolveSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse('Invalid request', 400);
  }

  const match = await prisma.duplicateMatch.findUnique({
    where: { id: matchId },
    select: { id: true, sourcePodcastId: true, status: true },
  });

  if (!match) {
    return errorResponse('Match not found', 404);
  }

  if (match.status !== 'PENDING') {
    return errorResponse('Match already resolved', 409);
  }

  const { action, resolution } = parsed.data;

  if (action === 'approve') {
    // Approve: set podcast to READY, mark match as APPROVED
    await prisma.$transaction([
      prisma.duplicateMatch.update({
        where: { id: matchId },
        data: {
          status: 'APPROVED',
          reviewedBy: session.user.id,
          resolution: resolution || 'Approved by admin — content is not a duplicate.',
          reviewedAt: new Date(),
        },
      }),
      prisma.podcast.update({
        where: { id: match.sourcePodcastId },
        data: { status: 'READY' },
      }),
    ]);
  } else {
    // Reject: mark podcast as FAILED, mark match as REJECTED
    await prisma.$transaction([
      prisma.duplicateMatch.update({
        where: { id: matchId },
        data: {
          status: 'REJECTED',
          reviewedBy: session.user.id,
          resolution: resolution || 'Rejected by admin — content is a duplicate.',
          reviewedAt: new Date(),
        },
      }),
      prisma.podcast.update({
        where: { id: match.sourcePodcastId },
        data: { status: 'FAILED', failureReason: 'Import rejected: duplicate content detected.' },
      }),
    ]);
  }

  return NextResponse.json({ success: true });
}
