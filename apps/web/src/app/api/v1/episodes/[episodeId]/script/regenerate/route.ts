import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { admitDurableJob, deepResearchQueue, JobType, scriptWritingQueue } from '@/lib/queue';
import { invalidateEpisodeCache, publishEpisodeStatus } from '@/lib/redis';
import { regenerateWithFeedbackSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { formatUserFeedback } from '@/lib/feedback-formatter';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
class ScriptRevisionConflict extends Error {}
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
        originalScript?: { id: string; version: number };
      }
    | undefined;
  try {
    const text = new TextDecoder().decode(await readRequestBytes(request, 65536));
    if (text.trim()) {
      const parsed = regenerateWithFeedbackSchema.parse(JSON.parse(text));
      feedbackBody = parsed ?? undefined;
    }
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return errorResponse('Feedback body exceeds 65536 bytes', 413);
    return errorResponse('Invalid feedback body', 400);
  }
  if (feedbackBody?.sourceUrls?.length) {
    return errorResponse(
      'Adding source URLs during regeneration is unsupported. Start a new lesson with the source material so it can be researched and verified.',
      400
    );
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

  const originalScript = feedbackBody
    ? await prisma.script.findUnique({
        where: { episodeId },
        select: { id: true, version: true, updatedAt: true, turns: true },
      })
    : null;
  const turns = z
    .array(z.object({ speaker: z.string(), text: z.string() }).passthrough())
    .safeParse(originalScript?.turns);
  if (
    feedbackBody?.originalScript &&
    (feedbackBody.originalScript.id !== originalScript?.id ||
      feedbackBody.originalScript.version !== originalScript?.version)
  )
    return errorResponse('The original script changed. Reload before regenerating.', 409);
  const annotated = Boolean(
    Object.keys(feedbackBody?.turnComments ?? {}).length || feedbackBody?.highlights?.length
  );
  if (annotated && (!turns.success || !originalScript)) {
    return errorResponse('The original script is unavailable for these annotations.', 409);
  }
  if (
    turns.success &&
    (Object.keys(feedbackBody?.turnComments ?? {}).some((index) => !turns.data[Number(index)]) ||
      feedbackBody?.highlights?.some(
        (highlight) => !turns.data[highlight.turnIndex]?.text.includes(highlight.text)
      ))
  )
    return errorResponse('Annotations do not match the original script.', 400);
  const revisionFeedback = feedbackBody
    ? formatUserFeedback({ ...feedbackBody, turns: turns.success ? turns.data : undefined })
    : undefined;
  if (revisionFeedback && revisionFeedback.length > 40000)
    return errorResponse('Feedback and its original dialogue exceed 40000 characters.', 400);

  // Re-enter pipeline at script-writing (dossier + outline already exist)
  const dossier = await prisma.researchDossier.findUnique({ where: { episodeId } });
  const outline = await prisma.creativeOutline.findUnique({ where: { episodeId } });

  try {
    if (!dossier || !outline) {
      const payload = {
        episodeId,
        userId,
        discoveryId: discovery.id,
        ...(revisionFeedback ? { revisionFeedback } : {}),
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
          const removed = await database.script.deleteMany({
            where: {
              episodeId,
              ...(originalScript
                ? {
                    id: originalScript.id,
                    version: originalScript.version,
                    updatedAt: originalScript.updatedAt,
                  }
                : {}),
            },
          });
          if (originalScript && removed.count !== 1)
            throw new ScriptRevisionConflict(
              'The original script changed. Reload before regenerating.'
            );
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
        ...(revisionFeedback ? { revisionFeedback } : {}),
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
          const removed = await database.script.deleteMany({
            where: {
              episodeId,
              ...(originalScript
                ? {
                    id: originalScript.id,
                    version: originalScript.version,
                    updatedAt: originalScript.updatedAt,
                  }
                : {}),
            },
          });
          if (originalScript && removed.count !== 1)
            throw new ScriptRevisionConflict(
              'The original script changed. Reload before regenerating.'
            );
        },
      });
      await invalidateEpisodeCache(episodeId);
      await publishEpisodeStatus(episodeId, { status: 'SCRIPTING' });
    }
  } catch (error) {
    if (error instanceof ScriptRevisionConflict) return errorResponse(error.message, 409);
    throw error;
  }
  return NextResponse.json({ success: true });
}
