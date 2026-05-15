import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ userId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { userId } = await params;

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!targetUser) {
    return errorResponse('User not found', 404);
  }

  const collections = await prisma.collection.findMany({
    where: {
      userId,
      isPublic: true,
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      isPublic: true,
      podcastCount: true,
      createdAt: true,
      user: {
        select: { id: true, name: true, handle: true, image: true },
      },
    },
  });

  return NextResponse.json({
    collections: collections.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}
