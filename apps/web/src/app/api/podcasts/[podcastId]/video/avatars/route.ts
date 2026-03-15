import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/api-keys';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { checkAvatarGenerationGate, tryIncrementAvatarGeneration } from '@/lib/video-gate';
import { configureAvatarsSchema } from '@/lib/validations';
import { listUnifiedAvatars } from '@/lib/providers/avatar';
import type { AvatarProviderId } from '@/lib/providers/avatar-registry';
import { getAvatarModelProvider } from '@/lib/providers/avatar-registry';
import { fetchAvatarModels } from '@/lib/avatar-cost-estimator';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import { deleteFile, extractR2Key } from '@/lib/r2';
import { addJob, JobType, avatarGenerationQueue } from '@/lib/queue';
import { logger } from '@/lib/logger';
import { cache } from '@/lib/redis';

type RouteParams = { params: Promise<{ podcastId: string }> };

/**
 * GET — List available avatars (Redis-cached, 1hr TTL).
 * Accepts ?provider=heygen|runway|fal.
 * Provider defaults to the user's configured avatar provider from auto model config.
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

  // Fetch config first to determine defaults
  const [avatarModels, config] = await Promise.all([
    fetchAvatarModels().catch(() => []),
    getAutoModelConfig(),
  ]);

  // Determine the default avatar model and included list for this user's plan
  const defaultAvatarModel = gate.isProUser ? config.proAvatarModel : config.freeAvatarModel;
  const defaultAvatarProvider = (gate.isProUser ? config.proAvatarProvider : config.freeAvatarProvider) as AvatarProviderId;
  const includedModels = (gate.isProUser ? config.proIncludedAvatarModels : config.freeIncludedAvatarModels) ?? [defaultAvatarModel];

  // Derive available providers from config: a provider is available if it has an API key
  // AND at least one of its models is in the included list (or is the default)
  const apiKeyMap: Record<AvatarProviderId, string | undefined> = {
    heygen: process.env.HEYGEN_API_KEY,
    runway: process.env.RUNWAY_API_KEY,
    fal: process.env.FAL_KEY,
  };

  const allRelevantModels = [defaultAvatarModel, ...includedModels];
  const providerHasModels = (pid: AvatarProviderId) =>
    allRelevantModels.some((modelId) => getAvatarModelProvider(modelId) === pid);

  const availableProviders = {
    heygen: !!apiKeyMap.heygen && providerHasModels('heygen'),
    runway: !!apiKeyMap.runway && providerHasModels('runway'),
    fal: !!apiKeyMap.fal && providerHasModels('fal'),
  };

  // Use requested provider if available, otherwise fall back to the configured default
  const requestedProvider = request.nextUrl.searchParams.get('provider') as AvatarProviderId | null;
  const provider: AvatarProviderId = (requestedProvider && availableProviders[requestedProvider])
    ? requestedProvider
    : defaultAvatarProvider;

  const apiKey = apiKeyMap[provider];
  if (!apiKey) return errorResponse('Avatar generation is not configured', 503);

  // Filter avatar models for the active provider — only those in the included list
  const providerModels = avatarModels
    .filter((m) => getAvatarModelProvider(m.modelId) === provider)
    .filter((m) => includedModels.includes(m.modelId) || m.modelId === defaultAvatarModel);

  // Find cost per minute from the configured default or first available model
  let matchedModel = providerModels.find((m) => m.modelId === defaultAvatarModel);
  if (!matchedModel) matchedModel = providerModels[0];
  if (!matchedModel) {
    // Fall back to any model from the provider for pricing
    matchedModel = avatarModels.find((m) => getAvatarModelProvider(m.modelId) === provider);
  }

  const costPerMinute = matchedModel?.costPerMinute ?? 0;
  const includedOnPlatform = matchedModel ? includedModels.includes(matchedModel.modelId) : false;
  const pricingMeta = { costPerMinute, includedOnPlatform };

  // Check Redis cache (uses module-level singleton — no new connections)
  const cacheKey = `avatars:${provider}:${podcastId}`;
  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      return NextResponse.json({
        avatars: cached,
        providers: availableProviders,
        defaultProvider: defaultAvatarProvider,
        defaultModel: defaultAvatarModel,
        models: providerModels,
        pricing: pricingMeta,
      });
    }
  } catch {
    // Cache miss, proceed to API
  }

  try {
    const avatars = await listUnifiedAvatars(apiKey, provider, authResult.userId);

    // Cache for 1 hour
    try {
      await cache.set(cacheKey, avatars, 3600);
    } catch {
      // Non-critical cache write failure
    }

    return NextResponse.json({
      avatars,
      providers: availableProviders,
      defaultProvider: defaultAvatarProvider,
      defaultModel: defaultAvatarModel,
      models: providerModels,
      pricing: pricingMeta,
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
    select: { id: true, userId: true, status: true },
  });

  if (!podcast) return errorResponse('Podcast not found', 404);

  const adminId = await requireAdmin();
  if (podcast.userId !== authResult.userId && !adminId) {
    return errorResponse('Forbidden', 403);
  }

  if (podcast.status !== 'READY') {
    return errorResponse('Podcast must be READY to configure avatars', 400);
  }

  const body = await request.json();
  const parsed = configureAvatarsSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(`Invalid request: ${parsed.error.issues[0].message}`, 400);
  }

  const avatarVoiceTrackId: string | null = parsed.data.voiceTrackId ?? null;
  const videoGeneration = await prisma.videoGeneration.findFirst({
    where: { podcastId, voiceTrackId: avatarVoiceTrackId },
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
          avatarId: avatar.avatarId ?? '',
          avatarProvider: avatar.avatarProvider ?? null,
          avatarImageUrl: avatar.avatarImageUrl ?? null,
          avatarModelId: avatar.avatarModelId ?? null,
          enabledSegmentIds: avatar.enabledSegmentIds ?? [],
          voiceTrackId: avatar.voiceTrackId ?? null,
          status: 'pending',
        },
        update: {
          avatarId: avatar.avatarId ?? '',
          avatarProvider: avatar.avatarProvider ?? null,
          avatarImageUrl: avatar.avatarImageUrl ?? null,
          avatarModelId: avatar.avatarModelId ?? null,
          enabledSegmentIds: avatar.enabledSegmentIds ?? [],
          voiceTrackId: avatar.voiceTrackId ?? null,
          status: 'pending',
          videoUrl: null,
          concatAudioUrl: null,
          heygenVideoId: null,
          runwaySessionId: null,
          runwayChunkIndex: null,
          runwayTotalChunks: null,
          falRequestId: null,
          falChunkIndex: null,
          falTotalChunks: null,
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

    for (const overlay of overlays) {
      const avatarConfig = parsed.data.avatars.find((a) => a.speaker === overlay.speaker);
      const resolvedProvider = overlay.avatarProvider ?? avatarConfig?.avatarProvider ?? 'heygen';
      await addJob(avatarGenerationQueue, JobType.GENERATE_AVATAR, {
        podcastId,
        videoGenerationId: videoGeneration.id,
        avatarOverlayId: overlay.id,
        speaker: overlay.speaker,
        avatarId: overlay.avatarId,
        avatarProvider: resolvedProvider as 'heygen' | 'runway' | 'fal',
        avatarImageUrl: overlay.avatarImageUrl ?? avatarConfig?.avatarImageUrl ?? undefined,
        avatarModelId: overlay.avatarModelId ?? avatarConfig?.avatarModelId ?? undefined,
        isPreset: avatarConfig?.isPreset,
        voiceTrackId: overlay.voiceTrackId ?? undefined,
      });
    }

    await prisma.videoGeneration.update({
      where: { id: videoGeneration.id },
      data: { status: 'GENERATING_AVATARS' },
    });

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

  const delUrl = new URL(request.url);
  const delVoiceTrackId = delUrl.searchParams.get('voiceTrackId');
  const videoGeneration = await prisma.videoGeneration.findFirst({
    where: { podcastId, voiceTrackId: delVoiceTrackId ?? null },
    select: {
      id: true,
      avatarOverlays: { select: { id: true, videoUrl: true, concatAudioUrl: true, chunkVideoUrl: true } },
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
    if (overlay.chunkVideoUrl) {
      const key = extractR2Key(overlay.chunkVideoUrl);
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
