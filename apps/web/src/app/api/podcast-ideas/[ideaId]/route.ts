import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ ideaId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { ideaId } = await params;
  const userId = session.user.id;

  const idea = await prisma.podcastIdea.findUnique({
    where: { id: ideaId },
    select: { userId: true },
  });

  if (!idea) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (idea.userId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.podcastIdea.delete({ where: { id: ideaId } });

  return NextResponse.json({ success: true });
}
