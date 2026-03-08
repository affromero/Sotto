import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { copyrightClaimSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';
import { errorResponse } from '@/lib/api-response';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  // Rate limit: 5 copyright claims per hour
  const rateLimit = await checkRateLimit(`copyright-claim:${session.user.id}`, 5, 3600);
  if (!rateLimit.allowed) {
    return errorResponse('Too many claims. Please try again later.', 429);
  }

  const body = await request.json();
  const parsed = copyrightClaimSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  // Verify podcast exists
  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  // Verify segmentVisual exists if provided
  if (parsed.data.segmentVisualId) {
    const visual = await prisma.segmentVisual.findUnique({
      where: { id: parsed.data.segmentVisualId },
      select: { id: true, videoGeneration: { select: { podcastId: true } } },
    });

    if (!visual || visual.videoGeneration.podcastId !== podcastId) {
      return errorResponse('Segment visual not found for this podcast', 404);
    }
  }

  const report = await prisma.report.create({
    data: {
      reporterId: session.user.id,
      targetType: 'podcast',
      targetId: podcastId,
      reason: 'COPYRIGHT',
      description: parsed.data.description,
      claimantEmail: parsed.data.claimantEmail,
      claimantName: parsed.data.claimantName,
      evidenceUrl: parsed.data.evidenceUrl ?? null,
      segmentVisualId: parsed.data.segmentVisualId ?? null,
      status: 'REVIEWING',
    },
  });

  return NextResponse.json({ id: report.id, status: report.status }, { status: 201 });
}
