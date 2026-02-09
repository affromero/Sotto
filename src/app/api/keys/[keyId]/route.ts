import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type RouteParams = { params: Promise<{ keyId: string }> };

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { keyId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = await prisma.apiKey.findUnique({
    where: { id: keyId },
    select: { userId: true, revokedAt: true },
  });

  if (!apiKey) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 });
  }

  if (apiKey.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (apiKey.revokedAt) {
    return NextResponse.json({ error: 'API key already revoked' }, { status: 400 });
  }

  await prisma.apiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });

  return new NextResponse(null, { status: 204 });
}
