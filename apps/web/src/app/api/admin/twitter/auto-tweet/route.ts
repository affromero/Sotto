import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prisma } from '@/lib/prisma';
import { manualTweet } from '@/lib/twitter-auto-tweet';
import { manualTweetSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
export async function GET(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20', 10);
  const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0', 10);

  const [autoTweets, total] = await Promise.all([
    prisma.twitterAutoTweet.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
      skip: offset,
      include: {
        podcast: { select: { title: true, topic: true } },
      },
    }),
    prisma.twitterAutoTweet.count(),
  ]);

  return NextResponse.json({ autoTweets, total });
}

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = manualTweetSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: parsed.data.podcastId },
    select: { id: true, status: true, visibility: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  if (podcast.status !== 'READY') {
    return errorResponse('Podcast must be READY to tweet', 400);
  }

  const id = await manualTweet(parsed.data.podcastId);
  return NextResponse.json({ id }, { status: 201 });
}
