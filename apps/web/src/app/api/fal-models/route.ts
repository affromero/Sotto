import { NextRequest, NextResponse } from 'next/server';
import { hasByokKey } from '@/lib/byok';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { fetchFalImageModels, fetchAllVideoModels } from '@/lib/video-cost-estimator';
import { getAutoModelConfig, resolveIncludedImageModels, resolveIncludedVideoModels, resolveImageModel, resolveVideoModel } from '@/lib/auto-model-config';
import { getVideoModelProvider, type VideoProviderId } from '@/lib/providers/video-registry';
import { prisma } from '@/lib/prisma';

/**
 * GET — Returns available image and video models with live pricetoken pricing.
 * Filters by user's plan tier: returns included models + models from BYOK providers.
 * Includes plan-appropriate default models.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return errorResponse('Unauthorized', 401);

  const [user, imageModels, videoModels, autoConfig, userHasFalKey, userHasMiniMaxKey, userHasHeraKey, userHasReplicateKey] = await Promise.all([
    prisma.user.findUnique({ where: { id: auth.userId }, select: { plan: true, role: true } }),
    fetchFalImageModels(),
    fetchAllVideoModels(),
    getAutoModelConfig(),
    hasByokKey(auth.userId, 'fal'),
    hasByokKey(auth.userId, 'minimax'),
    hasByokKey(auth.userId, 'hera'),
    hasByokKey(auth.userId, 'replicate'),
  ]);

  const tier = (user?.plan as 'FREE' | 'PRO') ?? 'FREE';
  const isAdmin = user?.role === 'ADMIN';

  // Platform keys count — users don't need BYOK if the platform provides them
  const hasFalKey = userHasFalKey || !!process.env.FAL_KEY;
  const hasMiniMaxKey = userHasMiniMaxKey || !!process.env.MINIMAX_API_KEY;
  const hasHeraKey = userHasHeraKey || !!process.env.HERA_API_KEY;
  const hasReplicateKey = userHasReplicateKey || !!process.env.REPLICATE_API_TOKEN;

  // Resolve plan defaults
  const [configuredImage, configuredVideo] = await Promise.all([
    resolveImageModel(tier),
    resolveVideoModel(tier),
  ]);

  // Admins in PRO view mode see the same curated set as PRO users
  const adminProView = isAdmin && autoConfig.adminViewMode === 'PRO';

  // Admins (ALL mode) see all models; regular users + admins in PRO view see tier-included + BYOK-accessible models
  let filteredImageModels = imageModels;
  let filteredVideoModels = videoModels;

  if (!isAdmin || adminProView) {
    // Determine which BYOK video providers the user has access to
    const byokVideoProviders = new Set<VideoProviderId>();
    if (userHasFalKey) byokVideoProviders.add('fal');
    if (userHasMiniMaxKey) byokVideoProviders.add('minimax');
    if (userHasHeraKey) byokVideoProviders.add('hera');
    if (userHasReplicateKey) byokVideoProviders.add('replicate');

    // Image model filtering
    const { freeImageModels, proImageModels } = resolveIncludedImageModels(autoConfig);
    const effectiveTier = adminProView ? 'PRO' : tier;
    const allowedImageSet = new Set(effectiveTier === 'PRO' ? proImageModels : freeImageModels);
    // BYOK users with a fal key can use any fal image model
    if (userHasFalKey) {
      for (const m of imageModels) allowedImageSet.add(m.modelId);
    }
    filteredImageModels = imageModels.filter((m) => allowedImageSet.has(m.modelId));

    // Video model filtering
    const { freeVideoModels, proVideoModels } = resolveIncludedVideoModels(autoConfig);
    const allowedVideoSet = new Set(effectiveTier === 'PRO' ? proVideoModels : freeVideoModels);
    // BYOK users can use any model from their BYOK providers
    for (const m of videoModels) {
      const provider = getVideoModelProvider(m.modelId);
      if (provider && byokVideoProviders.has(provider)) {
        allowedVideoSet.add(m.modelId);
      }
    }
    filteredVideoModels = videoModels.filter((m) => allowedVideoSet.has(m.modelId));
  }

  return NextResponse.json({
    imageModels: filteredImageModels.map((m) => ({
      modelId: m.modelId,
      displayName: m.displayName,
      pricePerImage: m.pricePerImage,
      defaultResolution: m.defaultResolution,
      qualityTier: m.qualityTier,
    })),
    videoModels: filteredVideoModels.map((m) => ({
      modelId: m.modelId,
      displayName: m.displayName,
      costPerMinute: m.costPerMinute,
      resolution: m.resolution,
      maxDuration: m.maxDuration,
      qualityMode: m.qualityMode,
    })),
    hasFalKey,
    hasMiniMaxKey,
    hasHeraKey,
    hasReplicateKey,
    defaultImageModel: configuredImage.imageModel,
    defaultVideoModel: configuredVideo.videoModel,
  });
}
