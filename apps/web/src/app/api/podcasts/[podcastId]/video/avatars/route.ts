import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { checkVideoGenerationGate } from '@/lib/video-gate';
import { configureAvatarsSchema } from '@/lib/validations';
import { listAvatars } from '@/lib/heygen';
import { deleteFile, extractR2Key } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { createRedisConnection } from '@/lib/redis';

type RouteParams = { params: Promise<{ podcastId: string }> };

const MAX_AVATAR_DURATION_SECONDS = 600;

/**
 * GET — List available HeyGen stock avatars (Redis-cached, 1hr TTL).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);
  if (!authResult) return errorResponse('Unauthorized', 401);

  const gate = await checkVideoGenerationGate(authResult.userId);
  if (!gate.allowed) {
    const message = gate.reason === 'daily_limit_reached'
      ? 'Daily video generation limit reached. Try again later.'
      : 'No image provider available.';
    return errorResponse(message, gate.reason === 'daily_limit_reached' ? 429 : 403, { code: gate.reason });
  }

  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) return errorResponse('Avatar generation is not configured', 503);

  // Check Redis cache
  const redis = createRedisConnection('avatar-cache');
  const cacheKey = `heygen:avatars:${podcastId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return NextResponse.json({ avatars: JSON.parse(cached) });
    }
  } catch {
    // Cache miss, proceed to API
  }

  try {
    const avatars = await listAvatars(apiKey);
    const filtered = avatars.filter((a) => !a.premium);

    // Cache for 1 hour
    try {
      await redis.set(cacheKey, JSON.stringify(filtered), 'EX', 3600);
    } catch {
      // Non-critical cache write failure
    }

    return NextResponse.json({ avatars: filtered });
  } catch (err) {
    logger.error('Failed to list HeyGen avatars', {
      error: err instanceof Error ? err.message : String(err),
    });
    return errorResponse('Failed to fetch avatars', 502);
  }
}

/**
 * POST — Configure avatar overlays for a video generation.
 * Creates/upserts AvatarOverlay records. Does NOT start generation.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);
  if (!authResult) return errorResponse('Unauthorized', 401);

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { id: true, userId: true, status: true, duration: true },
  });

  if (!podcast) return errorResponse('Podcast not found', 404);

  const adminId = await requireAdmin();
  if (podcast.userId !== authResult.userId && !adminId) {
    return errorResponse('Forbidden', 403);
  }

  if (podcast.status !== 'READY') {
    return errorResponse('Podcast must be READY to configure avatars', 400);
  }

  if (podcast.duration && podcast.duration > MAX_AVATAR_DURATION_SECONDS) {
    return errorResponse(`Podcast too long for avatars (max ${MAX_AVATAR_DURATION_SECONDS / 60} minutes)`, 400);
  }

  const body = await request.json();
  const parsed = configureAvatarsSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(`Invalid request: ${parsed.error.issues[0].message}`, 400);
  }

  const videoGeneration = await prisma.videoGeneration.findUnique({
    where: { podcastId },
    select: { id: true, status: true },
  });

  if (!videoGeneration) {
    return errorResponse('No video generation found — generate video first', 400);
  }

  // Upsert overlays per speaker
  const overlays = await Promise.all(
    parsed.data.avatars.map((avatar) =>
      prisma.avatarOverlay.upsert({
        where: {
          videoGenerationId_speaker: {
            videoGenerationId: videoGeneration.id,
            speaker: avatar.speaker,
          },
        },
        create: {
          videoGenerationId: videoGeneration.id,
          speaker: avatar.speaker,
          avatarId: avatar.avatarId,
          status: 'pending',
        },
        update: {
          avatarId: avatar.avatarId,
          status: 'pending',
          videoUrl: null,
          concatAudioUrl: null,
          heygenVideoId: null,
          failureReason: null,
        },
      }),
    ),
  );

  logger.info('Avatar overlays configured', {
    podcastId,
    videoGenerationId: videoGeneration.id,
    speakers: parsed.data.avatars.map((a) => a.speaker).join(', '),
  });

  return NextResponse.json({ overlays });
}

/**
 * DELETE — Remove all avatar overlays and clean up R2 assets.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

  const videoGeneration = await prisma.videoGeneration.findUnique({
    where: { podcastId },
    select: {
      id: true,
      avatarOverlays: { select: { id: true, videoUrl: true, concatAudioUrl: true } },
    },
  });

  if (!videoGeneration) {
    return errorResponse('No video generation found', 404);
  }

  // Delete R2 assets
  const deletePromises: Promise<void>[] = [];
  for (const overlay of videoGeneration.avatarOverlays) {
    if (overlay.videoUrl) {
      const key = extractR2Key(overlay.videoUrl);
      if (key) deletePromises.push(deleteFile(key));
    }
    if (overlay.concatAudioUrl) {
      const key = extractR2Key(overlay.concatAudioUrl);
      if (key) deletePromises.push(deleteFile(key));
    }
  }
  await Promise.allSettled(deletePromises);

  // Delete records
  await prisma.avatarOverlay.deleteMany({
    where: { videoGenerationId: videoGeneration.id },
  });

  logger.info('Avatar overlays deleted', { podcastId });

  return NextResponse.json({ success: true });
}
