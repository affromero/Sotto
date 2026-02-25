import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
/**
 * DELETE /api/ideas/:ideaId
 * Remove a saved idea.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ideaId: string }> }
) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }

  const { ideaId } = await params;

  const idea = await prisma.savedIdea.findUnique({
    where: { id: ideaId },
    select: { userId: true },
  });

  if (!idea) {
    return errorResponse('Not found', 404);
  }

  if (idea.userId !== authed.userId) {
    return errorResponse('Forbidden', 403);
  }

  await prisma.savedIdea.delete({ where: { id: ideaId } });

  return NextResponse.json({ deleted: true });
}
