import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prismaUnfiltered } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ episodeId: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return errorResponse('Unauthorized', 401);
  }

  const userRole = (session.user as Record<string, unknown>)?.role as string;

  if (userRole !== 'ADMIN') {
    return errorResponse('Forbidden', 403);
  }

  const { episodeId } = await context.params;

  try {
    const episode = await prismaUnfiltered.episode.findUnique({
      where: { id: episodeId },
      select: { deletedAt: true },
    });

    if (!episode) {
      return errorResponse('Episode not found', 404);
    }

    if (episode.deletedAt) {
      return errorResponse('Episode already deleted', 409);
    }

    await prismaUnfiltered.episode.update({
      where: { id: episodeId },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch {
    return errorResponse('Failed to delete episode', 500);
  }
}
