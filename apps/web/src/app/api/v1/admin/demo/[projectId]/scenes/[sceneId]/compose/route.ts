import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { addJob, JobType, demoSceneCompositionQueue } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';

interface Params {
  params: Promise<{ projectId: string; sceneId: string }>;
}

/** POST — Queue per-scene composition (recording + voiceover sync) */
export async function POST(_request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId, sceneId } = await params;

  const scene = await prisma.demoScene.findFirst({
    where: { id: sceneId, projectId },
    select: { recordingStatus: true, voiceoverStatus: true },
  });

  if (!scene) return errorResponse('Scene not found', 404);
  if (scene.recordingStatus !== 'READY') return errorResponse('Recording not ready', 400);
  if (scene.voiceoverStatus !== 'READY') return errorResponse('Voiceover not ready', 400);

  await prisma.demoScene.update({
    where: { id: sceneId },
    data: { compositedStatus: 'GENERATING' },
  });

  const job = await addJob(
    demoSceneCompositionQueue,
    JobType.COMPOSE_DEMO_SCENE,
    { projectId, sceneId },
    { jobId: `demo-scene-compose-${sceneId}-${Date.now()}` },
  );

  return NextResponse.json({ status: 'queued', jobId: job.id });
}
