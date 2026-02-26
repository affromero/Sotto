import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { getAdminQueue } from '@/lib/queue-admin';
import { ALL_QUEUE_NAMES } from '@/lib/queue';

export const dynamic = 'force-dynamic';

export async function GET(
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
  const jobs = await queue.getFailed(0, 19);

  const result = jobs.map((job) => ({
    id: job.id,
    name: job.name,
    failedReason: job.failedReason,
    timestamp: job.timestamp,
    attemptsMade: job.attemptsMade,
  }));

  return NextResponse.json({ jobs: result });
}
