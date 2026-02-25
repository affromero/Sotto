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
    select: { id: true, userId: true, visibility: true, currentVersion: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  // Only owner can see versions of private podcasts
  if (podcast.visibility === 'PRIVATE' && podcast.userId !== session.user.id) {
    return errorResponse('Forbidden', 403);
  }

  const versions = await prisma.podcastVersion.findMany({
    where: { podcastId },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      audioUrl: true,
      duration: true,
      changeType: true,
      changeSummary: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ versions, currentVersion: podcast.currentVersion });
}
