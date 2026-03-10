import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import {
  addJob,
  JobType,
  demoRecordingQueue,
  demoVoiceoverQueue,
  demoVisualQueue,
  demoTransitionQueue,
} from '@/lib/queue';

interface Params {
  params: Promise<{ projectId: string }>;
}

/** POST — Queue ALL assets for all scenes in a project */
export async function POST(_request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId } = await params;

  const project = await prisma.demoProject.findUnique({
    where: { id: projectId },
    select: { status: true },
  });

  if (!project) return errorResponse('Project not found', 404);
  if (project.status === 'DRAFT') {
    return errorResponse('Script not ready — generate script first', 400);
  }

  const scenes = await prisma.demoScene.findMany({
    where: { projectId },
    orderBy: { order: 'asc' },
    select: { id: true, visualType: true, transitionType: true, order: true },
  });

  if (scenes.length === 0) {
    return errorResponse('No scenes to generate assets for', 400);
  }

  // Update project status
  await prisma.demoProject.update({
    where: { id: projectId },
    data: { status: 'GENERATING_ASSETS' },
  });

  const now = Date.now();
  const jobs: Promise<unknown>[] = [];

  for (const scene of scenes) {
    // Queue recording for every scene
    jobs.push(addJob(
      demoRecordingQueue,
      JobType.GENERATE_DEMO_RECORDING,
      { projectId, sceneId: scene.id },
      { jobId: `demo-record-${scene.id}-${now}` },
    ));

    // Queue voiceover for every scene
    jobs.push(addJob(
      demoVoiceoverQueue,
      JobType.GENERATE_DEMO_VOICEOVER,
      { projectId, sceneId: scene.id },
      { jobId: `demo-voiceover-${scene.id}-${now}` },
    ));

    // Queue visual only if type is set
    if (scene.visualType) {
      jobs.push(addJob(
        demoVisualQueue,
        JobType.GENERATE_DEMO_VISUAL,
        { projectId, sceneId: scene.id },
        { jobId: `demo-visual-${scene.id}-${now}` },
      ));
    }

    // Queue transition only if type is set (not for last scene)
    if (scene.transitionType && scene.order < scenes.length - 1) {
      jobs.push(addJob(
        demoTransitionQueue,
        JobType.GENERATE_DEMO_TRANSITION,
        { projectId, sceneId: scene.id },
        { jobId: `demo-transition-${scene.id}-${now}` },
      ));
    }
  }

  await Promise.all(jobs);

  return NextResponse.json({
    status: 'queued',
    totalJobs: jobs.length,
    scenes: scenes.length,
  });
}
