import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/redis';
import { createCommentSchema, paginationSchema } from '@/lib/validations';
import { moderateOrThrow, ContentModerationError } from '@/lib/moderation';
import { checkSuspension } from '@/lib/auth-guards';
import { notificationQueue, addJob, JobType } from '@/lib/queue';
import type { SendNotificationPayload } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
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
    return errorResponse('Invalid query parameters', 400);
  }

  const { page, limit } = parsed.data;

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, visibility: true, userId: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  // For private/unlisted podcasts, only the owner can view comments
  if (podcast.visibility !== 'PUBLIC') {
    const session = await auth();
    if (session?.user?.id !== podcast.userId) {
      return errorResponse('Not found', 404);
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
    return errorResponse('Unauthorized', 401);
  }

  const suspended = checkSuspension(session);
  if (suspended) return suspended;

  const userId = session.user.id;

  // Rate limit: 30 comments per hour
  const rateLimit = await checkRateLimit(`comment:${userId}`, 30, 3600);
  if (!rateLimit.allowed) {
    return errorResponse('Too many comments. Please try again later.', 429, { resetAt: rateLimit.resetAt });
  }

  const body = await request.json();
  const parsed = createCommentSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse('Invalid input', 400, { details: parsed.error.flatten().fieldErrors });
  }

  const { content, parentId, timestamp } = parsed.data;

  // Screen comment content for policy violations
  try {
    await moderateOrThrow(content);
  } catch (err) {
    if (err instanceof ContentModerationError) {
      return errorResponse('Your comment was flagged by our content policy.', 400, { categories: err.categories });
    }
    throw err;
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, userId: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  // If replying, verify parent exists and belongs to the same podcast
  let parentComment: { id: string; podcastId: string; userId: string } | null = null;
  if (parentId) {
    parentComment = await prisma.comment.findUnique({
      where: { id: parentId },
      select: { id: true, podcastId: true, userId: true },
    });

    if (!parentComment || parentComment.podcastId !== podcastId) {
      return errorResponse('Parent comment not found', 404);
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

  // Fire-and-forget notifications
  prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
    .then((commenter) => {
      const commenterName = commenter?.name ?? 'Someone';
      const promises: Promise<unknown>[] = [];

      // Notify podcast owner about the comment
      if (podcast.userId !== userId) {
        const ownerPayload: SendNotificationPayload = {
          userId: podcast.userId,
          type: 'COMMENT_ON_YOUR_PODCAST',
          title: 'New comment on your podcast',
          message: `${commenterName} commented on your podcast`,
          data: { podcastId, commentId: comment.id },
        };
        promises.push(addJob(notificationQueue, JobType.SEND_NOTIFICATION, ownerPayload));
      }

      // If reply, notify parent comment author (avoid double-notifying podcast owner)
      if (parentId && parentComment && parentComment.userId !== userId && parentComment.userId !== podcast.userId) {
        const replyPayload: SendNotificationPayload = {
          userId: parentComment.userId,
          type: 'COMMENT_REPLY',
          title: 'Reply to your comment',
          message: `${commenterName} replied to your comment`,
          data: { podcastId, commentId: comment.id, parentCommentId: parentId },
        };
        promises.push(addJob(notificationQueue, JobType.SEND_NOTIFICATION, replyPayload));
      }

      return Promise.all(promises);
    })
    .catch(() => {});

  return NextResponse.json(
    {
      ...comment,
      createdAt: comment.createdAt.toISOString(),
    },
    { status: 201 }
  );
}
