import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      image: true,
      bio: true,
      createdAt: true,
      _count: {
        select: {
          podcasts: { where: { status: 'READY', visibility: 'PUBLIC' } },
          followers: true,
          following: true,
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  let isFollowing = false;
  const session = await auth();
  if (session?.user?.id && session.user.id !== userId) {
    const follow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: session.user.id,
          followingId: userId,
        },
      },
    });
    isFollowing = !!follow;
  }

  return NextResponse.json({
    id: user.id,
    name: user.name,
    image: user.image,
    bio: user.bio,
    createdAt: user.createdAt,
    podcastCount: user._count.podcasts,
    followerCount: user._count.followers,
    followingCount: user._count.following,
    isFollowing,
  });
}
