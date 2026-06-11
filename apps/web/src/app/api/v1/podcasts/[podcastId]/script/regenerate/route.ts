import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { addJob, JobType, scriptWritingQueue } from '@/lib/queue';
import { invalidatePodcastCache, publishPodcastStatus } from '@/lib/redis';
import { regenerateWithFeedbackSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ podcastId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authResult.userId;

  // Parse optional feedback body
  let feedbackBody: { feedback?: string; turnComments?: Record<number, string>; highlights?: Array<{ turnIndex: number; text: string; note: string }>; sourceUrls?: string[] } | undefined;
  try {
    const text = await request.text();
    if (text.trim()) {
      const parsed = regenerateWithFeedbackSchema.parse(JSON.parse(text));
      feedbackBody = parsed ?? undefined;
    }
  } catch {
    return errorResponse('Invalid feedback body', 400);
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true, status: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }
  if (podcast.userId !== userId) {
    return errorResponse('Forbidden', 403);
  }
  if (podcast.status !== 'SCRIPT_READY') {
    return errorResponse('Script can only be regenerated when status is SCRIPT_READY', 400);
  }

  const discovery = await prisma.discovery.findUnique({
    where: { podcastId },
  });
  if (!discovery) {
    return errorResponse('Discovery not found', 404);
  }

  // Delete existing script, segments, and references
  await prisma.$transaction([
    prisma.segment.deleteMany({ where: { podcastId } }),
    prisma.reference.deleteMany({ where: { podcastId } }),
    prisma.script.deleteMany({ where: { podcastId } }),
  ]);

  // Re-enter pipeline at script-writing (dossier + outline already exist)
  const dossier = await prisma.researchDossier.findUnique({ where: { podcastId } });
  const outline = await prisma.creativeOutline.findUnique({ where: { podcastId } });

  if (!dossier || !outline) {
    // If no dossier/outline (legacy podcast or data loss), restart from research
    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'RESEARCHING', lowReferences: false },
    });
    await invalidatePodcastCache(podcastId);
    await publishPodcastStatus(podcastId, { status: 'RESEARCHING' });

    const { deepResearchQueue: researchQueue } = await import('@/lib/queue');
    await addJob(researchQueue, JobType.DEEP_RESEARCH, {
      podcastId,
      userId,
      discoveryId: discovery.id,
    });
  } else {
    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'SCRIPTING', lowReferences: false },
    });
    await invalidatePodcastCache(podcastId);
    await publishPodcastStatus(podcastId, { status: 'SCRIPTING' });

    await addJob(scriptWritingQueue, JobType.WRITE_SCRIPT, {
      podcastId,
      userId,
      discoveryId: discovery.id,
      dossierId: dossier.id,
      outlineId: outline.id,
      ...(feedbackBody?.sourceUrls?.length ? { sourceUrls: feedbackBody.sourceUrls } : {}),
    });
  }

  return NextResponse.json({ success: true });
}
