import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { errorResponse } from '@/lib/api-response';
import { addJob, JobType, lipSyncTestQueue } from '@/lib/queue';
import { checkRateLimit } from '@/lib/redis';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const submitSchema = z.object({
  audioUrl: z.string().min(1),
  avatarImageUrl: z.string().url(),
  avatarModelId: z.string().min(1),
});

/** Convert a data URL to a Buffer + content type. */
function parseDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { contentType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

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

    const rateLimit = await checkRateLimit(`lip-sync-test:${session.user.id}`, 3, 60);
    if (!rateLimit.allowed) {
      return errorResponse('Rate limit exceeded (3 tests per minute)', 429);
    }

    // If audioUrl is a data URL, upload to R2 first so Fal can access it
    let { audioUrl } = parsed.data;
    if (audioUrl.startsWith('data:')) {
      const parsed_data = parseDataUrl(audioUrl);
      if (!parsed_data) return errorResponse('Invalid audio data URL', 400);
      const key = `lip-sync-test/${session.user.id}/${Date.now()}.mp3`;
      audioUrl = await uploadFile(key, parsed_data.buffer, parsed_data.contentType);
      logger.info('Uploaded lip-sync test audio to R2', { key });
    }

    const job = await addJob(lipSyncTestQueue, JobType.LIP_SYNC_TEST, {
      userId: session.user.id,
      audioUrl,
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
