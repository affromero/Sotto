import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * DELETE /api/ideas/:ideaId
 * Remove a saved idea.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ ideaId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { ideaId } = await params;

  const idea = await prisma.savedIdea.findUnique({
    where: { id: ideaId },
    select: { userId: true },
  });

  if (!idea) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (idea.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.savedIdea.delete({ where: { id: ideaId } });

  return NextResponse.json({ deleted: true });
}
