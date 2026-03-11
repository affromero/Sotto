import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { z } from 'zod';
import {
  demoRecordingQueue,
  demoVoiceoverQueue,
  demoVisualQueue,
  demoTransitionQueue,
  demoSceneCompositionQueue,
  demoCompositionQueue,
} from '@/lib/queue';
import type { Queue } from 'bullmq';

const paramsSchema = z.object({ jobId: z.string().min(1) });

type RouteParams = { params: Promise<{ jobId: string }> };

/** Resolve the correct queue from the job ID prefix.
 *  IMPORTANT: check longer prefixes first to avoid collisions
 *  (demo-scene-compose- vs demo-compose-). */
function resolveQueue(jobId: string): Queue | null {
  if (jobId.startsWith('demo-scene-compose-')) return demoSceneCompositionQueue;
  if (jobId.startsWith('demo-record-')) return demoRecordingQueue;
  if (jobId.startsWith('demo-voiceover-')) return demoVoiceoverQueue;
  if (jobId.startsWith('demo-visual-')) return demoVisualQueue;
  if (jobId.startsWith('demo-transition-')) return demoTransitionQueue;
  if (jobId.startsWith('demo-compose-')) return demoCompositionQueue;
  return null;
}

/** DELETE — Cancel a BullMQ demo job (best-effort: removes if waiting, fails if active) */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return errorResponse('Invalid jobId', 400);
  const { jobId } = parsed.data;

  const queue = resolveQueue(jobId);
  if (!queue) return errorResponse('Unknown job type', 400);

  const job = await queue.getJob(jobId);
  if (!job) return NextResponse.json({ cancelled: true }); // already gone

  try {
    await job.remove();
  } catch {
    // Job is active — force-fail it so the worker result is discarded
    try {
      await job.moveToFailed(new Error('Cancelled by user'), '0', true);
    } catch {
      // Best effort — job may have already completed
    }
  }

  return NextResponse.json({ cancelled: true });
}

/** GET — Poll BullMQ job progress for a demo queue job */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return errorResponse('Invalid jobId', 400);
  const { jobId } = parsed.data;

  const queue = resolveQueue(jobId);
  if (!queue) return errorResponse('Unknown job type', 400);

  const job = await queue.getJob(jobId);
  if (!job) return errorResponse('Job not found', 404);

  const state = await job.getState();

  return NextResponse.json({
    state,
    progress: typeof job.progress === 'number' ? job.progress : 0,
    failedReason: state === 'failed' ? job.failedReason : null,
  });
}
