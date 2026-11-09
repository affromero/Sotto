import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prismaUnfiltered } from '@/lib/prisma';
import { resolveInteractionSchema } from '@/lib/validations';
import { isAccessError } from 'thesidedoor-core/access';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import {
  InteractionEpisodeNotFoundError,
  readInteractionEpisode,
} from '@/lib/sidedoor/jobs/interaction-access';

import { errorResponse } from '@/lib/api-response';
type RouteParams = { params: Promise<{ episodeId: string; interactionId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { episodeId, interactionId } = await params;
  const authed = await authenticateRequest(request);

  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }
  const userId = authed.userId;

  const body = await request.json().catch(() => ({}));
  const parsed = resolveInteractionSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const result = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        await requireOriginalSottoAdmission(database, request, authed);
        await readInteractionEpisode(database, episodeId);
        await database.$queryRaw`SELECT id FROM "Interaction" WHERE id = ${interactionId} AND "episodeId" = ${episodeId} FOR UPDATE`;
        const interaction = await database.interaction.findUnique({
          where: { id: interactionId, episodeId },
          select: { userId: true, status: true },
        });
        if (!interaction) return { error: 'Interaction not found', status: 404 } as const;
        if (interaction.userId !== userId) return { error: 'Forbidden', status: 403 } as const;
        if (interaction.status !== 'ANSWERED')
          return {
            error: 'Interaction must be in ANSWERED status to resolve',
            status: 400,
          } as const;
        await requireOriginalSottoAdmission(database, request, authed);
        request.signal.throwIfAborted();
        const updated = await database.interaction.update({
          where: { id: interactionId },
          data: { status: 'RESOLVED', resolved: true, helpful: parsed.data.helpful },
          select: { id: true, status: true, helpful: true },
        });
        return { updated } as const;
      },
      { signal: request.signal }
    );
    if ('error' in result && typeof result.error === 'string' && typeof result.status === 'number')
      return errorResponse(result.error, result.status, undefined, headers);
    return NextResponse.json(result.updated, { headers });
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
