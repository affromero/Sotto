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

  logger.info('Discovery client-error received', { userId: session.user.id, errorKind });

  try {
    const record = await prisma.discoveryChatError.create({
      data: {
        userId: session.user.id,
        userMessage,
        errorKind,
        discoveryId,
      },
    });
    logger.info('Discovery client-error saved', { id: record.id, errorKind });
    return NextResponse.json({ ok: true, id: record.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Failed to save client-side discovery error', { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
