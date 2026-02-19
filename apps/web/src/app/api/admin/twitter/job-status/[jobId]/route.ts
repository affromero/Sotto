import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { adminThreadToPodcastQueue } from '@/lib/queue';

type RouteParams = { params: Promise<{ jobId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { jobId } = await params;
  const job = await adminThreadToPodcastQueue.getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const state = await job.getState();
  return NextResponse.json({
    state,
    progress: typeof job.progress === 'number' ? job.progress : 0,
    podcastId: (job.data as Record<string, unknown>).podcastId ?? null,
    failedReason: state === 'failed' ? job.failedReason : null,
  });
}
