import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createCommentSchema, paginationSchema } from '@/lib/validations';
import { moderateOrThrow, ContentModerationError } from '@/lib/moderation';
import { checkSuspension } from '@/lib/auth-guards';

type RouteParams = { params: Promise<{ podcastId: string }> };

const commentUserSelect = {
  id: true,
  name: true,
  image: true,
  handle: true,
} as const;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const { searchParams } = new URL(request.url);

  const parsed = paginationSchema.safeParse({
    page: searchParams.get('page') ?? '1',
    limit: searchParams.get('limit') ?? '20',
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
  }

  const { page, limit } = parsed.data;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, visibility: true, userId: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  // For private/unlisted podcasts, only the owner can view comments
  if (podcast.visibility !== 'PUBLIC') {
    const session = await auth();
    if (session?.user?.id !== podcast.userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  }

  const [items, total] = await Promise.all([
    prisma.comment.findMany({
      where: { podcastId, parentId: null },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        content: true,
        timestamp: true,
        replyCount: true,
        createdAt: true,
        user: { select: commentUserSelect },
      },
    }),
    prisma.comment.count({
      where: { podcastId, parentId: null },
    }),
  ]);

  return NextResponse.json({
    items: items.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const suspended = checkSuspension(session);
  if (suspended) return suspended;

  const userId = session.user.id;

  const body = await request.json();
  const parsed = createCommentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { content, parentId, timestamp } = parsed.data;

  // Screen comment content for policy violations
  try {
    await moderateOrThrow(content);
  } catch (err) {
    if (err instanceof ContentModerationError) {
      return NextResponse.json(
        { error: 'Your comment was flagged by our content policy.', categories: err.categories },
        { status: 400 }
      );
    }
    throw err;
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, userId: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  // If replying, verify parent exists and belongs to the same podcast
  if (parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: parentId },
      select: { id: true, podcastId: true },
    });

    if (!parent || parent.podcastId !== podcastId) {
      return NextResponse.json({ error: 'Parent comment not found' }, { status: 404 });
    }
  }

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: {
        content,
        userId,
        podcastId,
        parentId: parentId ?? null,
        timestamp: timestamp ?? null,
      },
      select: {
        id: true,
        content: true,
        timestamp: true,
        replyCount: true,
        createdAt: true,
        user: { select: commentUserSelect },
      },
    });

    // Increment parent's replyCount if this is a reply
    if (parentId) {
      await tx.comment.update({
        where: { id: parentId },
        data: { replyCount: { increment: 1 } },
      });
    }

    // Increment podcast's commentCount
    await tx.podcast.update({
      where: { id: podcastId },
      data: { commentCount: { increment: 1 } },
    });

    return created;
  });

  // Fire-and-forget activity record
  prisma.activity.create({
    data: {
      userId,
      type: 'COMMENT_POSTED',
      targetId: podcastId,
      targetType: 'podcast',
      metadata: { commentId: comment.id },
    },
  }).catch(() => {});

  return NextResponse.json(
    {
      ...comment,
      createdAt: comment.createdAt.toISOString(),
    },
    { status: 201 }
  );
}
