import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { selectMusicGenerationSchema } from '@/lib/validations';
import { logger } from '@/lib/logger';

type RouteParams = { params: Promise<{ podcastId: string }> };

/**
 * PATCH — Select a music generation as the active one for the podcast.
 * Sets selected=true on the target, false on all others, and updates Podcast.musicUrl.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, userId: true },
  });

  if (!podcast) {
    return errorResponse('Podcast not found', 404);
  }

  const adminId = await requireAdmin();
  if (podcast.userId !== authResult.userId && !adminId) {
    return errorResponse('Forbidden', 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const parsed = selectMusicGenerationSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request body', 400, { errors: parsed.error.flatten().fieldErrors });
  }

  const { generationId } = parsed.data;

  // Verify the generation exists, belongs to this podcast, and is READY
  const target = await prisma.musicGeneration.findFirst({
    where: { id: generationId, podcastId },
    select: { id: true, status: true, musicUrl: true },
  });

  if (!target) {
    return errorResponse('Music generation not found', 404);
  }

  if (target.status !== 'READY' || !target.musicUrl) {
    return errorResponse('Can only select a completed music generation', 400);
  }

  // Deselect all, select target, update Podcast.musicUrl
  await prisma.$transaction([
    prisma.musicGeneration.updateMany({
      where: { podcastId, selected: true },
      data: { selected: false },
    }),
    prisma.musicGeneration.update({
      where: { id: generationId },
      data: { selected: true },
    }),
    prisma.podcast.update({
      where: { id: podcastId },
      data: { musicUrl: target.musicUrl },
    }),
  ]);

  logger.info('Music generation selected', { podcastId, generationId });

  return NextResponse.json({ success: true, musicUrl: target.musicUrl });
}
