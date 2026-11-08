import { NextRequest, NextResponse } from 'next/server';
import { prismaUnfiltered } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { updateEpisodeSchema } from '@/lib/validations';
import { EPISODE_PUBLIC_SELECT } from '@/lib/episode-select';
import { resolveAudioUrl } from '@/lib/r2';
import { generateEpisodeSlug } from '@/lib/slugify';
import { errorResponse } from '@/lib/api-response';
import { cache, getEpisodeCacheTtl, invalidateEpisodeCache } from '@/lib/redis';
import { isAccessError } from 'thesidedoor-core/access';
import type { Prisma } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import {
  InteractionEpisodeNotFoundError,
  readInteractionEpisode,
} from '@/lib/sidedoor/jobs/interaction-access';
type RouteParams = { params: Promise<{ episodeId: string }> };

const episodeDetailSelect = {
  ...EPISODE_PUBLIC_SELECT,
  verificationProgress: true,
  user: { select: { id: true, name: true, image: true } },
  tags: { include: { tag: true } },
  segments: { orderBy: { order: 'asc' } },
  interactions: {
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, name: true, image: true } } },
  },
} as const satisfies Prisma.EpisodeSelect;
type EpisodeDetail = Prisma.EpisodeGetPayload<{ select: typeof episodeDetailSelect }>;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const authResult = await authenticateRequest(request);
  const cacheKey = `episode:public:${episodeId}`;
  const cached = await cache.get<EpisodeDetail>(cacheKey);
  const headers = { 'Cache-Control': 'private, no-store' };
  let result:
    | { episode: EpisodeDetail; isSaved: boolean; failureReason: string | null; cacheHit: boolean }
    | { error: string };
  try {
    result = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        if (authResult) await requireOriginalSottoAdmission(database, request, authResult);
        await database.$queryRaw`SELECT id FROM "Episode" WHERE id = ${episodeId} FOR UPDATE`;
        const current = await database.episode.findUnique({
          where: { id: episodeId },
          select: {
            id: true,
            userId: true,
            visibility: true,
            deletedAt: true,
            status: true,
            updatedAt: true,
            currentVersion: true,
            failureReason: true,
            assessmentSection: { select: { id: true } },
            assessmentAudioAssessmentId: true,
          },
        });
        if (!current || current.deletedAt) return { error: 'Episode not found' };
        if (current.assessmentSection || current.assessmentAudioAssessmentId)
          return { error: 'Not found' };
        if (
          current.visibility === 'PRIVATE' &&
          (!authResult || authResult.userId !== current.userId)
        )
          return { error: 'Not found' };
        const cacheHit =
          !!cached &&
          current.visibility === 'UNLISTED' &&
          cached.visibility === 'UNLISTED' &&
          cached.id === current.id &&
          cached.userId === current.userId &&
          cached.status === current.status &&
          cached.currentVersion === current.currentVersion &&
          new Date(cached.updatedAt).getTime() === current.updatedAt.getTime() &&
          Array.isArray(cached.segments);
        const episode = cacheHit
          ? cached
          : await database.episode.findUnique({
              where: { id: episodeId },
              select: episodeDetailSelect,
            });
        if (!episode) return { error: 'Episode not found' };
        const isSaved =
          !!authResult &&
          !!(await database.save.findUnique({
            where: { userId_episodeId: { userId: authResult.userId, episodeId } },
          }));
        if (authResult) await requireOriginalSottoAdmission(database, request, authResult);
        request.signal.throwIfAborted();
        return {
          episode,
          isSaved,
          cacheHit,
          failureReason:
            authResult?.userId === current.userId && current.status === 'FAILED'
              ? current.failureReason
              : null,
        };
      },
      { signal: request.signal }
    );
  } catch (error) {
    if (isAccessError(error))
      return errorResponse(
        error.message,
        error.code === 'unauthorized' ? 401 : 409,
        undefined,
        headers
      );
    throw error;
  }
  if ('error' in result) return errorResponse(result.error, 404, undefined, headers);
  const { episode, isSaved, failureReason, cacheHit } = result;
  if (!cacheHit && episode.visibility === 'UNLISTED')
    await cache.set(cacheKey, episode, getEpisodeCacheTtl(episode.status));
  const [resolvedAudioUrl, resolvedSegments] = await Promise.all([
    resolveAudioUrl(episode.audioUrl),
    Promise.all(
      episode.segments.map(async (s) => ({
        ...s,
        audioUrl: await resolveAudioUrl(s.audioUrl),
      }))
    ),
  ]);
  return NextResponse.json(
    {
      ...episode,
      audioUrl: resolvedAudioUrl,
      segments: resolvedSegments,
      isSaved,
      ...(failureReason ? { failureReason } : {}),
    },
    { headers }
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  let updated;
  try {
    const result = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        await requireOriginalSottoAdmission(database, request, authResult);
        const episode = await readInteractionEpisode(database, episodeId);
        if (episode.userId !== authResult.userId)
          return { error: 'Forbidden', status: 403 } as const;
        const parsed = updateEpisodeSchema.safeParse(await request.clone().json());
        if (!parsed.success) return { error: parsed.error.flatten(), status: 400 } as const;
        const slugData = parsed.data.title
          ? { slug: await generateEpisodeSlug(parsed.data.title, authResult.userId, database) }
          : {};
        const updated = await database.episode.update({
          where: { id: episodeId },
          data: { ...parsed.data, ...slugData },
          select: {
            ...EPISODE_PUBLIC_SELECT,
            user: { select: { id: true, name: true, image: true } },
            tags: { include: { tag: true } },
          },
        });
        await requireOriginalSottoAdmission(database, request, authResult);
        request.signal.throwIfAborted();
        return { updated };
      },
      { signal: request.signal }
    );
    if (result.error !== undefined) return errorResponse(result.error, result.status);
    updated = result.updated;
  } catch (error) {
    if (error instanceof InteractionEpisodeNotFoundError)
      return errorResponse('Episode not found', 404);
    if (isAccessError(error))
      return errorResponse(error.message, error.code === 'unauthorized' ? 401 : 409);
    throw error;
  }
  await invalidateEpisodeCache(episodeId);

  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { episodeId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const result = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        await requireOriginalSottoAdmission(database, request, authResult);
        const episode = await readInteractionEpisode(database, episodeId);
        if (episode.userId !== authResult.userId) return false;
        await database.episode.update({
          where: { id: episodeId },
          data: { deletedAt: new Date() },
        });
        await requireOriginalSottoAdmission(database, request, authResult);
        request.signal.throwIfAborted();
        return true;
      },
      { signal: request.signal }
    );
    if (!result) return errorResponse('Forbidden', 403);
  } catch (error) {
    if (error instanceof InteractionEpisodeNotFoundError)
      return errorResponse('Episode not found', 404);
    if (isAccessError(error))
      return errorResponse(error.message, error.code === 'unauthorized' ? 401 : 409);
    throw error;
  }
  await invalidateEpisodeCache(episodeId);

  return new NextResponse(null, { status: 204 });
}
