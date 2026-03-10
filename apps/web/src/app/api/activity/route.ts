import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { paginationSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const { searchParams } = request.nextUrl;
  const parsed = paginationSchema.safeParse({
    page: searchParams.get('page') ?? '1',
    limit: searchParams.get('limit') ?? '20',
  });

  if (!parsed.success) {
    return errorResponse('Invalid query parameters', 400);
  }

  const { page, limit } = parsed.data;
  const skip = (page - 1) * limit;

  // Get list of users the current user follows
  const following = await prisma.follow.findMany({
    where: { followerId: authResult.userId },
    select: { followingId: true },
  });

  const followingIds = following.map((f) => f.followingId);

  if (followingIds.length === 0) {
    return NextResponse.json({ activities: [], hasMore: false });
  }

  const [activities, total] = await Promise.all([
    prisma.activity.findMany({
      where: { userId: { in: followingIds } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        type: true,
        targetId: true,
        targetType: true,
        metadata: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            handle: true,
            image: true,
          },
        },
      },
    }),
    prisma.activity.count({
      where: { userId: { in: followingIds } },
    }),
  ]);

  // Collect target IDs by type for batch fetching
  const podcastIds: string[] = [];
  const userIds: string[] = [];
  const collectionIds: string[] = [];

  for (const activity of activities) {
    if (!activity.targetId) continue;
    switch (activity.targetType) {
      case 'podcast':
        podcastIds.push(activity.targetId);
        break;
      case 'user':
        userIds.push(activity.targetId);
        break;
      case 'collection':
        collectionIds.push(activity.targetId);
        break;
    }
  }

  // Batch fetch target entities
  const [podcasts, users, collections] = await Promise.all([
    podcastIds.length > 0
      ? prisma.podcast.findMany({
          where: { id: { in: podcastIds } },
          select: { id: true, title: true },
        })
      : [],
    userIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, handle: true },
        })
      : [],
    collectionIds.length > 0
      ? prisma.collection.findMany({
          where: { id: { in: collectionIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);

  const podcastMap = new Map(podcasts.map((p) => [p.id, p]));
  const userMap = new Map(users.map((u) => [u.id, u]));
  const collectionMap = new Map(collections.map((c) => [c.id, c]));

  const enrichedActivities = activities.map((activity) => {
    let target: { title?: string | null; name?: string | null; handle?: string | null } | null = null;

    if (activity.targetId) {
      switch (activity.targetType) {
        case 'podcast':
          target = podcastMap.get(activity.targetId) ?? null;
          break;
        case 'user': {
          const u = userMap.get(activity.targetId);
          target = u ? { name: u.name, handle: u.handle } : null;
          break;
        }
        case 'collection': {
          const c = collectionMap.get(activity.targetId);
          target = c ? { name: c.name } : null;
          break;
        }
      }
    }

    return {
      ...activity,
      createdAt: activity.createdAt.toISOString(),
      target,
    };
  });

  return NextResponse.json({
    activities: enrichedActivities,
    hasMore: skip + limit < total,
  });
}
