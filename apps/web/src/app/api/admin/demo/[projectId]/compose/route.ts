import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { addJob, JobType, demoCompositionQueue } from '@/lib/queue';

interface Params {
  params: Promise<{ projectId: string }>;
}

/** POST — Compose final video from all scene assets */
export async function POST(_request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId } = await params;

  const project = await prisma.demoProject.findUnique({
    where: { id: projectId },
    include: {
      scenes: { orderBy: { order: 'asc' }, select: { id: true, order: true, recordingStatus: true, voiceoverStatus: true } },
    },
  });

  if (!project) return errorResponse('Project not found', 404);

  // Verify all scenes have at minimum recording + voiceover READY
  for (const scene of project.scenes) {
    if (scene.recordingStatus !== 'READY') {
      return errorResponse(`Scene ${scene.order} recording not ready`, 400);
    }
    if (scene.voiceoverStatus !== 'READY') {
      return errorResponse(`Scene ${scene.order} voiceover not ready`, 400);
    }
  }

  await prisma.demoProject.update({
    where: { id: projectId },
    data: { status: 'COMPOSING' },
  });

  await addJob(
    demoCompositionQueue,
    JobType.COMPOSE_DEMO,
    { projectId },
    { jobId: `demo-compose-${projectId}-${Date.now()}` },
  );

  return NextResponse.json({ status: 'queued' });
}
