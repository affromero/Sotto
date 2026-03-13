import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { errorResponse } from '@/lib/api-response';
import { addJob, JobType, lipSyncTestQueue } from '@/lib/queue';
import { checkRateLimit } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const submitSchema = z.object({
  audioUrl: z.string().url(),
  avatarImageUrl: z.string().url(),
  avatarModelId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    const body = await request.json();
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request', 400);
    }

    const limited = await checkRateLimit(`lip-sync-test:${session.user.id}`, 3, 60);
    if (limited) {
      return errorResponse('Rate limit exceeded (3 tests per minute)', 429);
    }

    const job = await addJob(lipSyncTestQueue, JobType.LIP_SYNC_TEST, {
      userId: session.user.id,
      audioUrl: parsed.data.audioUrl,
      avatarImageUrl: parsed.data.avatarImageUrl,
      avatarModelId: parsed.data.avatarModelId,
    });

    return NextResponse.json({ jobId: job.id });
  } catch (error: unknown) {
    logger.error('Failed to queue lip-sync test', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to queue lip-sync test', 500);
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    const jobId = request.nextUrl.searchParams.get('jobId');
    if (!jobId) {
      return errorResponse('Missing jobId', 400);
    }

    const job = await lipSyncTestQueue.getJob(jobId);
    if (!job) {
      return errorResponse('Job not found', 404);
    }

    // Verify ownership
    if (job.data.userId !== session.user.id) {
      return errorResponse('Not found', 404);
    }

    const state = await job.getState();
    const progress = job.progress;

    if (state === 'completed') {
      const result = job.returnvalue as { videoUrl: string } | undefined;
      return NextResponse.json({ status: 'completed', videoUrl: result?.videoUrl, progress });
    }

    if (state === 'failed') {
      return NextResponse.json({ status: 'failed', error: job.failedReason, progress });
    }

    return NextResponse.json({ status: state, progress });
  } catch (error: unknown) {
    logger.error('Failed to check lip-sync test status', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to check status', 500);
  }
}
