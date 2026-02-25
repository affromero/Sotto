import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createClaimReportSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';
import { addJob, notificationQueue, JobType } from '@/lib/queue';
import type { SendNotificationPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const rateLimit = await checkRateLimit(`claim:${session.user.id}`, 20, 3600);
  if (!rateLimit.allowed) {
    return errorResponse('Too many claim reports. Please try again later.', 429);
  }

  const body = await request.json();
  const parsed = createClaimReportSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { turnIndex, turnText, description } = parsed.data;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, userId: true, title: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  try {
    const claimReport = await prisma.claimReport.create({
      data: {
        reporterId: session.user.id,
        podcastId,
        turnIndex,
        turnText,
        description,
      },
    });

    if (podcast.userId !== session.user.id) {
      await addJob<SendNotificationPayload>(notificationQueue, JobType.SEND_NOTIFICATION, {
        userId: podcast.userId,
        type: 'CLAIM_REPORT_ON_YOUR_PODCAST',
        title: 'Claim flagged on your podcast',
        message: `Someone flagged a claim in "${podcast.title}" as potentially inaccurate.`,
        data: { podcastId, claimReportId: claimReport.id },
      });
    }

    return NextResponse.json({ id: claimReport.id, status: claimReport.status }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      return errorResponse('You have already flagged this claim.', 409);
    }
    throw err;
  }
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  const isOwnerOrAdmin = podcast.userId === session.user.id || session.user.role === 'ADMIN';
  if (!isOwnerOrAdmin) {
    return errorResponse('Forbidden', 403);
  }

  const claims = await prisma.claimReport.findMany({
    where: { podcastId },
    orderBy: { createdAt: 'desc' },
    include: {
      reporter: { select: { id: true, name: true, handle: true } },
    },
  });

  return NextResponse.json({ items: claims });
}
