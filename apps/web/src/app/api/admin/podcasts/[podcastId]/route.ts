import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prismaUnfiltered } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ podcastId: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return errorResponse('Unauthorized', 401);
  }

  const userRole = (session.user as Record<string, unknown>)?.role as string;

  if (userRole !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const { podcastId } = await context.params;

  try {
    const podcast = await prismaUnfiltered.podcast.findUnique({
      where: { id: podcastId },
      select: { deletedAt: true },
    });

    if (!podcast) {
      return errorResponse('Podcast not found', 404);
    }

    if (podcast.deletedAt) {
      return errorResponse('Podcast already deleted', 409);
    }

    await prismaUnfiltered.podcast.update({
      where: { id: podcastId },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch {
    return errorResponse('Failed to delete podcast', 500);
  }
}
