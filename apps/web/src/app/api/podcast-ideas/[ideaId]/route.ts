import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ ideaId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return errorResponse('Unauthorized', 401);
  }

  const { ideaId } = await params;
  const userId = session.user.id;

  const idea = await prisma.podcastIdea.findUnique({
    where: { id: ideaId },
    select: { userId: true },
  });

  if (!idea) {
    return errorResponse('Not found', 404);
  }

  if (idea.userId !== userId) {
    return errorResponse('Forbidden', 403);
  }

  await prisma.podcastIdea.delete({ where: { id: ideaId } });

  return NextResponse.json({ success: true });
}
