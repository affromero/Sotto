import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { updateMusicVolumeSchema } from '@/lib/validations';

type RouteParams = { params: Promise<{ podcastId: string }> };

/**
 * PATCH — Update music volume for a podcast (owner only).
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

  const body = await request.json().catch(() => null);
  const parsed = updateMusicVolumeSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request body', 400, { details: parsed.error.flatten() });
  }

  await prisma.podcast.update({
    where: { id: podcastId },
    data: { musicVolume: parsed.data.volume },
  });

  return NextResponse.json({ volume: parsed.data.volume });
}
