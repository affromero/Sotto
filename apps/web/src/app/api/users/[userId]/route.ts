import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
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
      handle: true,
      image: true,
      bio: true,
      createdAt: true,
      _count: {
        select: {
          podcasts: { where: { status: 'READY', visibility: 'PUBLIC', deletedAt: null } },
        },
      },
    },
  });

  if (!user) {
    return errorResponse('User not found', 404);
  }

  return NextResponse.json({
    id: user.id,
    name: user.name,
    handle: user.handle,
    image: user.image,
    bio: user.bio,
    createdAt: user.createdAt,
    podcastCount: user._count.podcasts,
  });
}
