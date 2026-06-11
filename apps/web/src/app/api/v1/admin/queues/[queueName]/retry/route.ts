import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { getAdminQueue } from '@/lib/queue-admin';
import { ALL_QUEUE_NAMES } from '@/lib/queue';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const retrySchema = z.object({ jobId: z.string() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ queueName: string }> }
) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { queueName } = await params;
  if (!(ALL_QUEUE_NAMES as readonly string[]).includes(queueName)) {
    return errorResponse('Unknown queue', 400);
  }

  const body = await req.json();
  const parsed = retrySchema.safeParse(body);
  if (!parsed.success) return errorResponse('Invalid input', 400, { details: parsed.error.flatten() });

  const queue = getAdminQueue(queueName);
  const job = await queue.getJob(parsed.data.jobId);
  if (!job) return errorResponse('Job not found', 404);

  await job.retry();
  logger.info('Admin retried failed job', { adminId, queueName, jobId: parsed.data.jobId });

  return NextResponse.json({ ok: true });
}
