import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prismaUnfiltered } from '@/lib/prisma';
import { isAccessError } from 'thesidedoor-core/access';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import {
  InteractionEpisodeNotFoundError,
  readInteractionEpisode,
} from '@/lib/sidedoor/jobs/interaction-access';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ episodeId: string; interactionId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { episodeId, interactionId } = await params;
  const authed = await authenticateRequest(request);

  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }
  const userId = authed.userId;

  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const result = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        await requireOriginalSottoAdmission(database, request, authed);
        const episode = await readInteractionEpisode(database, episodeId);
        const interaction = await database.interaction.findUnique({
          where: { id: interactionId, episodeId },
          select: {
            id: true,
            question: true,
            timestamp: true,
            status: true,
            answer: true,
            helpful: true,
            segmentOrder: true,
            userId: true,
          },
        });
        if (
          !interaction ||
          (interaction.userId !== userId &&
            episode.userId !== userId &&
            episode.visibility !== 'UNLISTED')
        )
          return null;
        await requireOriginalSottoAdmission(database, request, authed);
        request.signal.throwIfAborted();
        return {
          id: interaction.id,
          question: interaction.question,
          timestamp: interaction.timestamp,
          status: interaction.status,
          answer: interaction.answer,
          helpful: interaction.helpful,
          segmentOrder: interaction.segmentOrder,
        };
      },
      { signal: request.signal }
    );
    if (!result) return errorResponse('Interaction not found', 404, undefined, headers);
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof InteractionEpisodeNotFoundError)
      return errorResponse('Interaction not found', 404, undefined, headers);
    if (isAccessError(error))
      return errorResponse(
        error.message,
        error.code === 'unauthorized' ? 401 : 409,
        undefined,
        headers
      );
    throw error;
  }
}
