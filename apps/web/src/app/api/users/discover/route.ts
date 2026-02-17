import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { userDiscoverySearchSchema } from '@/lib/validations';

export async function GET(request: NextRequest) {
  const session = await auth();
  const currentUserId = session?.user?.id;

  const { searchParams } = request.nextUrl;
  const parsed = userDiscoverySearchSchema.safeParse({
    query: searchParams.get('query') ?? '',
    page: searchParams.get('page') ?? '1',
    limit: searchParams.get('limit') ?? '20',
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message },
      { status: 400 }
    );
  }

  const { query, page, limit } = parsed.data;
  const skip = (page - 1) * limit;

  // Find users matching by name/handle/bio OR by interest tag name
  const usersWithInterestTagMatch = await prisma.userInterest.findMany({
    where: {
      tag: { name: { contains: query, mode: 'insensitive' } },
      ...(currentUserId ? { userId: { not: currentUserId } } : {}),
    },
    select: { userId: true },
    distinct: ['userId'],
  });
  const interestMatchUserIds = usersWithInterestTagMatch.map((u) => u.userId);

  const where = {
    ...(currentUserId ? { id: { not: currentUserId } } : {}),
    OR: [
      { name: { contains: query, mode: 'insensitive' as const } },
      { handle: { contains: query, mode: 'insensitive' as const } },
      { bio: { contains: query, mode: 'insensitive' as const } },
      ...(interestMatchUserIds.length > 0
        ? [{ id: { in: interestMatchUserIds } }]
        : []),
    ],
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { followers: { _count: 'desc' } },
      select: {
        id: true,
        name: true,
        handle: true,
        image: true,
        bio: true,
        _count: { select: { followers: true, podcasts: { where: { deletedAt: null } } } },
        interests: {
          select: { tag: { select: { name: true } } },
          take: 5,
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  // Batch-check isFollowing
  let followingSet = new Set<string>();
  if (currentUserId && users.length > 0) {
    const follows = await prisma.follow.findMany({
      where: {
        followerId: currentUserId,
        followingId: { in: users.map((u) => u.id) },
      },
      select: { followingId: true },
    });
    followingSet = new Set(follows.map((f) => f.followingId));
  }

  const results = users.map((user) => ({
    id: user.id,
    name: user.name,
    handle: user.handle,
    image: user.image,
    bio: user.bio,
    followerCount: user._count.followers,
    podcastCount: user._count.podcasts,
    isFollowing: followingSet.has(user.id),
    interests: user.interests.map((i: { tag: { name: string } }) => i.tag.name),
  }));

  return NextResponse.json({
    users: results,
    total,
    page,
    limit,
    hasMore: skip + limit < total,
  });
}
