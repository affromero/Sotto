import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  const { searchParams } = request.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
  const skip = (page - 1) * limit;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, visibility: true, userId: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  if (podcast.visibility === 'PRIVATE' && podcast.userId !== userId) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  const where = {
    podcastId,
    visibility: 'PUBLIC',
    status: { in: ['ANSWERED', 'RESOLVED', 'INCORPORATED'] as const },
  };

  const [questions, total] = await Promise.all([
    prisma.interaction.findMany({
      where,
      orderBy: [{ upvoteCount: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
      select: {
        id: true,
        question: true,
        answer: true,
        timestamp: true,
        upvoteCount: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            handle: true,
          },
        },
      },
    }),
    prisma.interaction.count({ where }),
  ]);

  // Batch-check which interactions the current user has voted on
  let votedIds = new Set<string>();
  if (userId && questions.length > 0) {
    const votes = await prisma.interactionVote.findMany({
      where: {
        userId,
        interactionId: { in: questions.map((q) => q.id) },
      },
      select: { interactionId: true },
    });
    votedIds = new Set(votes.map((v) => v.interactionId));
  }

  const items = questions.map((q) => ({
    id: q.id,
    question: q.question,
    answer: q.answer,
    timestamp: q.timestamp,
    upvoteCount: q.upvoteCount,
    createdAt: q.createdAt.toISOString(),
    user: q.user,
    hasVoted: votedIds.has(q.id),
  }));

  return NextResponse.json({
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}
