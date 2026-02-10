import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type RouteParams = { params: Promise<{ entryId: string }> };

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { entryId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch entry and verify voice clone ownership
  const entry = await prisma.voiceAllowlist.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      voiceClone: { select: { userId: true } },
    },
  });

  if (!entry) {
    return NextResponse.json({ error: 'Allowlist entry not found' }, { status: 404 });
  }

  if (entry.voiceClone.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.voiceAllowlist.delete({
    where: { id: entryId },
  });

  return NextResponse.json({ success: true });
}
