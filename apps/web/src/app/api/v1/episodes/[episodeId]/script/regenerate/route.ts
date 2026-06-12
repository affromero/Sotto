import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { addJob, JobType, scriptWritingQueue } from '@/lib/queue';
import { invalidateEpisodeCache, publishEpisodeStatus } from '@/lib/redis';
import { regenerateWithFeedbackSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ episodeId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
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

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { userId: true, status: true },
  });

  if (!episode) {
    return errorResponse('Episode not found', 404);
  }
  if (episode.userId !== userId) {
    return errorResponse('Forbidden', 403);
  }
  if (episode.status !== 'SCRIPT_READY') {
    return errorResponse('Script can only be regenerated when status is SCRIPT_READY', 400);
  }

  const discovery = await prisma.discovery.findUnique({
    where: { episodeId },
  });
  if (!discovery) {
    return errorResponse('Discovery not found', 404);
  }

  // Delete existing script, segments, and references
  await prisma.$transaction([
    prisma.segment.deleteMany({ where: { episodeId } }),
    prisma.reference.deleteMany({ where: { episodeId } }),
    prisma.script.deleteMany({ where: { episodeId } }),
  ]);

  // Re-enter pipeline at script-writing (dossier + outline already exist)
  const dossier = await prisma.researchDossier.findUnique({ where: { episodeId } });
  const outline = await prisma.creativeOutline.findUnique({ where: { episodeId } });

  if (!dossier || !outline) {
    // If no dossier/outline (legacy episode or data loss), restart from research
    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'RESEARCHING', lowReferences: false },
    });
    await invalidateEpisodeCache(episodeId);
    await publishEpisodeStatus(episodeId, { status: 'RESEARCHING' });

    const { deepResearchQueue: researchQueue } = await import('@/lib/queue');
    await addJob(researchQueue, JobType.DEEP_RESEARCH, {
      episodeId,
      userId,
      discoveryId: discovery.id,
    });
  } else {
    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'SCRIPTING', lowReferences: false },
    });
    await invalidateEpisodeCache(episodeId);
    await publishEpisodeStatus(episodeId, { status: 'SCRIPTING' });

    await addJob(scriptWritingQueue, JobType.WRITE_SCRIPT, {
      episodeId,
      userId,
      discoveryId: discovery.id,
      dossierId: dossier.id,
      outlineId: outline.id,
      ...(feedbackBody?.sourceUrls?.length ? { sourceUrls: feedbackBody.sourceUrls } : {}),
    });
  }

  return NextResponse.json({ success: true });
}
