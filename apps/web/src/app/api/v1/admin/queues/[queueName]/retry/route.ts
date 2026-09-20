import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-response';
import { getAdminQueue } from '@/lib/queue-admin';
import { ALL_QUEUE_NAMES } from '@/lib/queue';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { isAccessError } from 'thesidedoor-core/access';
import { authenticateRequest } from '@/lib/api-keys';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { readFailedSottoDelivery, deliverSottoJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { prepareInitialStitchIdentities } from '@/lib/sidedoor/jobs/initial/initial-stitch-admission';
import { retryInitialStitch } from '@/lib/sidedoor/jobs/initial/initial-stitch-retry';

const retrySchema = z.object({ jobId: z.string() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ queueName: string }> }
) {
  const administrator = await authenticateRequest(req);
  if (!administrator?.isOwner) return errorResponse('Forbidden', 403);
  const adminId = administrator.userId;

  const { queueName } = await params;
  if (!(ALL_QUEUE_NAMES as readonly string[]).includes(queueName)) {
    return errorResponse('Unknown queue', 400);
  }

  const body = await req.json();
  const parsed = retrySchema.safeParse(body);
  if (!parsed.success)
    return errorResponse('Invalid input', 400, { details: parsed.error.flatten() });

  const queue = getAdminQueue(queueName);
  const job = await queue.getJob(parsed.data.jobId);
  if (!job) return errorResponse('Job not found', 404);

  if (queueName === 'audio-stitching' && job.name === 'audio-stitching.v2') {
    try {
      const failed = await readFailedSottoDelivery({
        database: prismaUnfiltered,
        queue,
        operationId: parsed.data.jobId,
        version: 2,
      });
      const identities = prepareInitialStitchIdentities();
      const replacement = await sottoTransaction(
        prismaUnfiltered,
        (tx) =>
          retryInitialStitch(tx, {
            request: req,
            administrator,
            operationId: failed.job.id,
            fingerprint: failed.fingerprint,
            identities,
          }),
        { signal: req.signal }
      );
      await deliverSottoJob({
        database: prismaUnfiltered,
        queue,
        operationId: replacement.job.id,
        fingerprint: replacement.fingerprint,
        version: 2,
      });
      logger.info('Admin retried failed stitching work', {
        adminId,
        queueName,
        jobId: replacement.job.id,
        previousJobId: failed.job.id,
      });
      return NextResponse.json({ ok: true, jobId: replacement.job.id });
    } catch (error) {
      if (!isAccessError(error)) throw error;
      return errorResponse(
        error.message,
        error.code === 'unauthorized' ? 401 : error.code === 'forbidden' ? 403 : 409
      );
    }
  }

  await job.retry();
  logger.info('Admin retried failed job', { adminId, queueName, jobId: parsed.data.jobId });

  return NextResponse.json({ ok: true });
}
