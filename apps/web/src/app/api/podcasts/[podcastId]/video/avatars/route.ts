import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { checkAvatarGenerationGate, tryIncrementAvatarGeneration } from '@/lib/video-gate';
import { configureAvatarsSchema } from '@/lib/validations';
import { listUnifiedAvatars } from '@/lib/providers/avatar';
import { deleteFile, extractR2Key } from '@/lib/r2';
import { addJob, JobType, avatarGenerationQueue } from '@/lib/queue';
import { logger } from '@/lib/logger';
import { createRedisConnection } from '@/lib/redis';

type RouteParams = { params: Promise<{ podcastId: string }> };

const MAX_AVATAR_DURATION_SECONDS = 600;

/**
 * GET — List available avatars (Redis-cached, 1hr TTL).
 * Accepts ?provider=heygen|runway (defaults to heygen).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const authResult = await authenticateRequest(request);
  if (!authResult) return errorResponse('Unauthorized', 401);

  const gate = await checkAvatarGenerationGate(authResult.userId);
  if (!gate.allowed) {
    const message = gate.reason === 'daily_limit_reached'
      ? 'Daily video generation limit reached. Try again later.'
      : 'No image provider available.';
    return errorResponse(message, gate.reason === 'daily_limit_reached' ? 429 : 403, { code: gate.reason });
  }

  const provider = (request.nextUrl.searchParams.get('provider') ?? 'heygen') as 'heygen' | 'runway';

  const apiKey = provider === 'runway' ? process.env.RUNWAY_API_KEY : process.env.HEYGEN_API_KEY;
  if (!apiKey) return errorResponse('Avatar generation is not configured', 503);

  // Check Redis cache
  const redis = createRedisConnection('avatar-cache');
  const cacheKey = `avatars:${provider}:${podcastId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return NextResponse.json({
        avatars: JSON.parse(cached),
        providers: {
          heygen: !!process.env.HEYGEN_API_KEY,
          runway: !!process.env.RUNWAY_API_KEY,
        },
      });
    }
  } catch {
    // Cache miss, proceed to API
  }

  try {
    const avatars = await listUnifiedAvatars(apiKey, provider);

    // Cache for 1 hour
    try {
      await redis.set(cacheKey, JSON.stringify(avatars), 'EX', 3600);
    } catch {
      // Non-critical cache write failure
    }

    return NextResponse.json({
      avatars,
      providers: {
        heygen: !!process.env.HEYGEN_API_KEY,
        runway: !!process.env.RUNWAY_API_KEY,
      },
    });
  } catch (err) {
    logger.error('Failed to list avatars', {
      provider,
      error: err instanceof Error ? err.message : String(err),
    });
    return errorResponse('Failed to fetch avatars', 502);
  }
}

/**
 * POST — Configure avatar overlays for a video generation.
 * Creates/upserts AvatarOverlay records. If the video generation is already
 * READY, auto-starts avatar generation (transitions to GENERATING_AVATARS).
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
          avatarProvider: avatar.avatarProvider ?? null,
          status: 'pending',
        },
        update: {
          avatarId: avatar.avatarId,
          avatarProvider: avatar.avatarProvider ?? null,
          status: 'pending',
          videoUrl: null,
          concatAudioUrl: null,
          heygenVideoId: null,
          runwaySessionId: null,
          runwayChunkIndex: null,
          runwayTotalChunks: null,
          maskShape: null,
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

  // Auto-start avatar generation if the video generation is already complete
  let generationStarted = false;
  if (videoGeneration.status === 'READY') {
    // Check avatar daily limit (separate counter from video)
    const gate = await checkAvatarGenerationGate(authResult.userId);
    if (!gate.allowed) {
      const message = gate.reason === 'daily_limit_reached'
        ? 'Daily avatar generation limit reached. Try again later.'
        : 'No image provider available.';
      return errorResponse(message, gate.reason === 'daily_limit_reached' ? 429 : 403, { code: gate.reason });
    }

    // Increment daily avatar counter (non-admin, non-BYOK users)
    if (!gate.isByokUser) {
      const incremented = await tryIncrementAvatarGeneration(authResult.userId, gate.dailyLimit);
      if (!incremented) {
        return errorResponse('Daily avatar generation limit reached. Try again later.', 429, {
          code: 'daily_limit_reached',
        });
      }
    }

    await prisma.videoGeneration.update({
      where: { id: videoGeneration.id },
      data: { status: 'GENERATING_AVATARS' },
    });

    for (const overlay of overlays) {
      const avatarConfig = parsed.data.avatars.find((a) => a.speaker === overlay.speaker);
      await addJob(avatarGenerationQueue, JobType.GENERATE_AVATAR, {
        podcastId,
        videoGenerationId: videoGeneration.id,
        avatarOverlayId: overlay.id,
        speaker: overlay.speaker,
        avatarId: overlay.avatarId,
        avatarProvider: (avatarConfig?.avatarProvider ?? 'heygen') as 'heygen' | 'runway',
        isPreset: avatarConfig?.isPreset,
      });
    }

    generationStarted = true;
    logger.info('Auto-started avatar generation for completed video', {
      podcastId,
      videoGenerationId: videoGeneration.id,
    });
  }

  return NextResponse.json({
    overlays,
    videoGenerationId: videoGeneration.id,
    generationStarted,
  });
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
