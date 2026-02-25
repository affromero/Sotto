import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginationSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string; commentId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { podcastId, commentId } = await params;
  const { searchParams } = new URL(request.url);

  const parsed = paginationSchema.safeParse({
    page: searchParams.get('page') ?? '1',
    limit: searchParams.get('limit') ?? '20',
  });

  if (!parsed.success) {
    return errorResponse('Invalid query parameters', 400);
  }

  const { page, limit } = parsed.data;

  // Verify the parent comment exists and belongs to this podcast
  const parent = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, podcastId: true },
  });

  if (!parent || parent.podcastId !== podcastId) {
    return errorResponse('Comment not found', 404);
  }

  const [items, total] = await Promise.all([
    prisma.comment.findMany({
      where: { parentId: commentId },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        content: true,
        timestamp: true,
        replyCount: true,
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
    prisma.comment.count({
      where: { parentId: commentId },
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
