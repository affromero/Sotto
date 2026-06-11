import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string }> };

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

  // Only owner or admin can view knowledge gaps
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });

  if (podcast.userId !== session.user.id && user?.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const interactions = await prisma.interaction.findMany({
    where: { podcastId },
    select: {
      segmentOrder: true,
      helpful: true,
    },
  });

  // Group by segmentOrder
  const segmentMap = new Map<
    number,
    { questionCount: number; helpfulCount: number; unhelpfulCount: number }
  >();

  for (const interaction of interactions) {
    const order = interaction.segmentOrder ?? -1;
    const existing = segmentMap.get(order) || {
      questionCount: 0,
      helpfulCount: 0,
      unhelpfulCount: 0,
    };
    existing.questionCount++;
    if (interaction.helpful === true) existing.helpfulCount++;
    if (interaction.helpful === false) existing.unhelpfulCount++;
    segmentMap.set(order, existing);
  }

  const segments = Array.from(segmentMap.entries())
    .filter(([order]) => order >= 0)
    .map(([segmentOrder, data]) => ({
      segmentOrder,
      questionCount: data.questionCount,
      helpfulCount: data.helpfulCount,
      unhelpfulCount: data.unhelpfulCount,
    }))
    .sort((a, b) => a.segmentOrder - b.segmentOrder);

  return NextResponse.json({
    segments,
    totalQuestions: interactions.length,
  });
}
