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
  const jobIds: Record<string, Record<string, string>> = {};
  let totalJobs = 0;

  for (const scene of scenes) {
    const sceneJobs: Record<string, string> = {};

    // Queue recording for every scene
    const recordJob = await addJob(
      demoRecordingQueue,
      JobType.GENERATE_DEMO_RECORDING,
      { projectId, sceneId: scene.id },
      { jobId: `demo-record-${scene.id}-${now}` },
    );
    sceneJobs.record = recordJob.id!;
    totalJobs++;

    // Queue voiceover for every scene
    const voiceoverJob = await addJob(
      demoVoiceoverQueue,
      JobType.GENERATE_DEMO_VOICEOVER,
      { projectId, sceneId: scene.id },
      { jobId: `demo-voiceover-${scene.id}-${now}` },
    );
    sceneJobs.voiceover = voiceoverJob.id!;
    totalJobs++;

    // Queue visual only if type is set
    if (scene.visualType) {
      const visualJob = await addJob(
        demoVisualQueue,
        JobType.GENERATE_DEMO_VISUAL,
        { projectId, sceneId: scene.id },
        { jobId: `demo-visual-${scene.id}-${now}` },
      );
      sceneJobs.visual = visualJob.id!;
      totalJobs++;
    }

    // Queue transition only if type is set (not for last scene)
    if (scene.transitionType && scene.order < scenes.length - 1) {
      const transitionJob = await addJob(
        demoTransitionQueue,
        JobType.GENERATE_DEMO_TRANSITION,
        { projectId, sceneId: scene.id },
        { jobId: `demo-transition-${scene.id}-${now}` },
      );
      sceneJobs.transition = transitionJob.id!;
      totalJobs++;
    }

    jobIds[scene.id] = sceneJobs;
  }

  return NextResponse.json({
    status: 'queued',
    totalJobs,
    scenes: scenes.length,
    jobIds,
  });
}
