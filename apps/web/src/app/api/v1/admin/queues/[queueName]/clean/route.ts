import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { getAdminQueue } from '@/lib/queue-admin';
import { ALL_QUEUE_NAMES } from '@/lib/queue';
import { logger } from '@/lib/logger';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ queueName: string }> }
) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { queueName } = await params;
  if (!(ALL_QUEUE_NAMES as readonly string[]).includes(queueName)) {
    return errorResponse('Unknown queue', 400);
  }

  const queue = getAdminQueue(queueName);
  const removed = await queue.clean(0, 100, 'failed');
  logger.info('Admin cleaned failed jobs', {
    adminId,
    queueName,
    removedCount: String(removed.length),
  });

  return NextResponse.json({ ok: true, removedCount: removed.length });
}
