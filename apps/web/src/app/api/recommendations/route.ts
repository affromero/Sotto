import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { findSimilarPodcasts } from '@/lib/recommendations';

import { errorResponse } from '@/lib/api-response';
export async function GET(request: NextRequest) {
  const podcastId = request.nextUrl.searchParams.get('podcastId');
  const topic = request.nextUrl.searchParams.get('topic');

  if (!podcastId && !topic) {
    return errorResponse('Either podcastId or topic query parameter is required', 400);
  }

  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }

  let searchTopic = topic || '';

  if (podcastId) {
    const podcast = await prisma.podcast.findUnique({
      where: { id: podcastId },
      select: { topic: true, title: true, userId: true },
    });

    if (!podcast || podcast.userId !== userId) {
      return errorResponse('Podcast not found', 404);
    }

    searchTopic = podcast.topic || podcast.title;
  }

  const recommendations = await findSimilarPodcasts({
    topic: searchTopic,
    userId,
    limit: 10,
  });

  return NextResponse.json(recommendations);
}
