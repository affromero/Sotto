import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { adminThreadToPodcastQueue } from '@/lib/queue';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ jobId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { jobId } = await params;
  const job = await adminThreadToPodcastQueue.getJob(jobId);
  if (!job) return errorResponse('Not found', 404);

  const state = await job.getState();
  const workerCount = await adminThreadToPodcastQueue.getWorkersCount();

  return NextResponse.json({
    state,
    progress: typeof job.progress === 'number' ? job.progress : 0,
    podcastId: (job.data as Record<string, unknown>).podcastId ?? null,
    failedReason: state === 'failed' ? job.failedReason : null,
    workerCount,
  });
}
