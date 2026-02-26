import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { Prisma, DuplicateMatchStatus } from '@prisma/client';
import { errorResponse } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'PENDING';
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50);

  const where: Prisma.DuplicateMatchWhereInput = {};
  if (status !== 'ALL') {
    where.status = status as DuplicateMatchStatus;
  }

  const [items, total] = await Promise.all([
    prisma.duplicateMatch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        sourcePodcast: {
          select: {
            id: true,
            title: true,
            duration: true,
            audioUrl: true,
            sourcePlatform: true,
            isHumanContent: true,
            createdAt: true,
            user: { select: { id: true, name: true, handle: true, image: true } },
          },
        },
        matchedPodcast: {
          select: {
            id: true,
            title: true,
            duration: true,
            audioUrl: true,
            sourcePlatform: true,
            isHumanContent: true,
            createdAt: true,
            user: { select: { id: true, name: true, handle: true, image: true } },
          },
        },
      },
    }),
    prisma.duplicateMatch.count({ where }),
  ]);

  return NextResponse.json({
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}
