import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginationSchema } from '@/lib/validations';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const { searchParams } = request.nextUrl;

  const parsed = paginationSchema.safeParse({
    page: searchParams.get('page') ?? '1',
    limit: searchParams.get('limit') ?? '20',
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
  }

  const { page, limit } = parsed.data;
  const skip = (page - 1) * limit;

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const [activities, total] = await Promise.all([
    prisma.activity.findMany({
      where: { userId },
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
    prisma.activity.count({ where: { userId } }),
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
    let target: { title?: string; name?: string; handle?: string | null } | null = null;

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
