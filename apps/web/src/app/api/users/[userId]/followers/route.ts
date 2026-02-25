import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const { searchParams } = request.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
  const skip = (page - 1) * limit;

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!targetUser) {
    return errorResponse('User not found', 404);
  }

  const session = await auth();
  const currentUserId = session?.user?.id;

  const [follows, total] = await Promise.all([
    prisma.follow.findMany({
      where: { followingId: userId },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        follower: {
          select: {
            id: true,
            name: true,
            handle: true,
            image: true,
          },
        },
      },
    }),
    prisma.follow.count({ where: { followingId: userId } }),
  ]);

  const followerUsers = follows.map((f) => f.follower);

  let followingSet = new Set<string>();
  if (currentUserId && followerUsers.length > 0) {
    const currentUserFollows = await prisma.follow.findMany({
      where: {
        followerId: currentUserId,
        followingId: { in: followerUsers.map((u) => u.id) },
      },
      select: { followingId: true },
    });
    followingSet = new Set(currentUserFollows.map((f) => f.followingId));
  }

  const followers = followerUsers.map((user) => ({
    id: user.id,
    name: user.name,
    handle: user.handle,
    image: user.image,
    isFollowing: followingSet.has(user.id),
  }));

  return NextResponse.json({ followers, total, page, limit });
}
