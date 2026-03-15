import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { updateAvatarPositionsSchema } from '@/lib/validations';

type RouteParams = { params: Promise<{ podcastId: string }> };

/**
 * PATCH — Update avatar overlay positions (normalized 0-1).
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);
  if (!authResult) return errorResponse('Unauthorized', 401);

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, userId: true },
  });

  if (!podcast) return errorResponse('Podcast not found', 404);

  const adminId = await requireAdmin();
  if (podcast.userId !== authResult.userId && !adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json();
  const parsed = updateAvatarPositionsSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(`Invalid request: ${parsed.error.issues[0].message}`, 400);
  }

  const posVoiceTrackId = parsed.data.voiceTrackId ?? null;
  const videoGeneration = await prisma.videoGeneration.findFirst({
    where: { podcastId, voiceTrackId: posVoiceTrackId },
    select: { id: true },
  });

  if (!videoGeneration) {
    return errorResponse('No video generation found', 404);
  }

  await Promise.all(
    parsed.data.positions.map((pos) => {
      const data: Record<string, number | string> = {};
      if (pos.posX !== undefined) data.posX = pos.posX;
      if (pos.posY !== undefined) data.posY = pos.posY;
      if (pos.width !== undefined) data.width = pos.width;
      if (pos.height !== undefined) data.height = pos.height;
      if (pos.maskShape !== undefined) data.maskShape = pos.maskShape;
      return prisma.avatarOverlay.updateMany({
        where: {
          videoGenerationId: videoGeneration.id,
          speaker: pos.speaker,
        },
        data,
      });
    }),
  );

  return NextResponse.json({ success: true });
}
