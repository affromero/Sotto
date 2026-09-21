import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { admitDurableJob, deepResearchQueue, JobType, scriptWritingQueue } from '@/lib/queue';
import { invalidateEpisodeCache, publishEpisodeStatus } from '@/lib/redis';
import { regenerateWithFeedbackSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { randomUUID } from 'node:crypto';
type RouteParams = { params: Promise<{ episodeId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const authResult = await authenticateRequest(request);
  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authResult.userId;

  // Parse optional feedback body
  let feedbackBody:
    | {
        feedback?: string;
        turnComments?: Record<number, string>;
        highlights?: Array<{ turnIndex: number; text: string; note: string }>;
        sourceUrls?: string[];
      }
    | undefined;
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

  // Re-enter pipeline at script-writing (dossier + outline already exist)
  const dossier = await prisma.researchDossier.findUnique({ where: { episodeId } });
  const outline = await prisma.creativeOutline.findUnique({ where: { episodeId } });

  if (!dossier || !outline) {
    const payload = {
      episodeId,
      userId,
      discoveryId: discovery.id,
    };
    await admitDurableJob(deepResearchQueue, JobType.DEEP_RESEARCH, payload, {
      jobId: `research-${episodeId}-${randomUUID()}`,
      authorize: async (database) => {
        await requireOriginalSottoAdmission(database, request, authResult);
        return { userId };
      },
      mutate: async (database, operationId) => {
        const claimed = await database.episode.updateMany({
          where: { id: episodeId, userId, status: 'SCRIPT_READY' },
          data: {
            status: 'RESEARCHING',
            lowReferences: false,
            pipelineGeneration: operationId,
          },
        });
        if (claimed.count !== 1) throw new Error('Episode is no longer ready to regenerate');
        await database.segment.deleteMany({ where: { episodeId } });
        await database.reference.deleteMany({ where: { episodeId } });
        await database.script.deleteMany({ where: { episodeId } });
      },
    });
    await invalidateEpisodeCache(episodeId);
    await publishEpisodeStatus(episodeId, { status: 'RESEARCHING' });
  } else {
    const payload = {
      episodeId,
      userId,
      discoveryId: discovery.id,
      dossierId: dossier.id,
      outlineId: outline.id,
      ...(feedbackBody?.sourceUrls?.length ? { sourceUrls: feedbackBody.sourceUrls } : {}),
    };
    await admitDurableJob(scriptWritingQueue, JobType.WRITE_SCRIPT, payload, {
      jobId: `write-${episodeId}-${randomUUID()}`,
      authorize: async (database) => {
        await requireOriginalSottoAdmission(database, request, authResult);
        return { userId };
      },
      mutate: async (database, operationId) => {
        const claimed = await database.episode.updateMany({
          where: { id: episodeId, userId, status: 'SCRIPT_READY' },
          data: {
            status: 'SCRIPTING',
            lowReferences: false,
            pipelineGeneration: operationId,
          },
        });
        if (claimed.count !== 1) throw new Error('Episode is no longer ready to regenerate');
        await database.segment.deleteMany({ where: { episodeId } });
        await database.reference.deleteMany({ where: { episodeId } });
        await database.script.deleteMany({ where: { episodeId } });
      },
    });
    await invalidateEpisodeCache(episodeId);
    await publishEpisodeStatus(episodeId, { status: 'SCRIPTING' });
  }

  return NextResponse.json({ success: true });
}
