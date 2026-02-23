import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const userMessage = typeof body.message === 'string' ? body.message.slice(0, 2000) : '';
  const errorKind =
    typeof body.errorKind === 'string' ? body.errorKind : 'client_stream_fallback';
  const discoveryId = typeof body.discoveryId === 'string' ? body.discoveryId : null;

  await prisma.discoveryChatError
    .create({
      data: {
        userId: session.user.id,
        userMessage,
        errorKind,
        discoveryId,
      },
    })
    .catch((err: Error) =>
      logger.warn('Failed to save client-side discovery error', { error: err.message })
    );

  return NextResponse.json({ ok: true });
}
