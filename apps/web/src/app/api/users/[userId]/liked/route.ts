import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const [likes, total] = await Promise.all([
    prisma.like.findMany({
      where: {
        userId,
        podcast: {
          status: 'READY',
          visibility: 'PUBLIC',
        },
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        podcast: {
          select: {
            id: true,
            title: true,
            topic: true,
            status: true,
            visibility: true,
            audioUrl: true,
            duration: true,
            playCount: true,
            likeCount: true,
            forkCount: true,
            createdAt: true,
            source: true,
            isHumanContent: true,
            forkedFromId: true,
            user: {
              select: { id: true, name: true, image: true, handle: true },
            },
            tags: {
              include: {
                tag: { select: { id: true, name: true, slug: true } },
              },
            },
          },
        },
      },
    }),
    prisma.like.count({
      where: {
        userId,
        podcast: {
          status: 'READY',
          visibility: 'PUBLIC',
        },
      },
    }),
  ]);

  const podcasts = likes.map((like) => ({
    ...like.podcast,
    createdAt: like.podcast.createdAt.toISOString(),
    tags: like.podcast.tags.map((pt) => pt.tag),
  }));

  return NextResponse.json({ podcasts, total, page, limit });
}
