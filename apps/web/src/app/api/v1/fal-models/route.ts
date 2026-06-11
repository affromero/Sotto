import { NextRequest, NextResponse } from 'next/server';
import { hasByokKey } from '@/lib/byok';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { fetchFalImageModels, fetchAllVideoModels } from '@/lib/video-cost-estimator';
import { getAutoModelConfig, resolveIncludedImageModels, resolveIncludedVideoModels, resolveImageModel, resolveVideoModel } from '@/lib/auto-model-config';
import { getVideoModelProvider, type VideoProviderId } from '@/lib/providers/video-registry';

/**
 * GET — Returns available image and video models with live pricetoken pricing.
 * Returns the unified configured models plus models from BYOK providers.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return errorResponse('Unauthorized', 401);

  const [imageModels, videoModels, autoConfig, userHasFalKey, userHasMiniMaxKey, userHasHeraKey, userHasReplicateKey] = await Promise.all([
    fetchFalImageModels(),
    fetchAllVideoModels(),
    getAutoModelConfig(),
    hasByokKey(auth.userId, 'fal'),
    hasByokKey(auth.userId, 'minimax'),
    hasByokKey(auth.userId, 'hera'),
    hasByokKey(auth.userId, 'replicate'),
  ]);

  // Platform keys count — users don't need BYOK if the platform provides them
  const hasFalKey = userHasFalKey || !!process.env.FAL_KEY;
  const hasMiniMaxKey = userHasMiniMaxKey || !!process.env.MINIMAX_API_KEY;
  const hasHeraKey = userHasHeraKey || !!process.env.HERA_API_KEY;
  const hasReplicateKey = userHasReplicateKey || !!process.env.REPLICATE_API_TOKEN;

  const [configuredImage, configuredVideo] = await Promise.all([
    resolveImageModel(),
    resolveVideoModel(),
  ]);

  const allowedImageSet = new Set(resolveIncludedImageModels(autoConfig));
  if (userHasFalKey) {
    for (const model of imageModels) allowedImageSet.add(model.modelId);
  }
  const filteredImageModels = hasFalKey
    ? imageModels.filter((model) => allowedImageSet.has(model.modelId))
    : [];

  const accessibleVideoProviders = new Set<VideoProviderId>();
  if (hasFalKey) accessibleVideoProviders.add('fal');
  if (hasMiniMaxKey) accessibleVideoProviders.add('minimax');
  if (hasHeraKey) accessibleVideoProviders.add('hera');
  if (hasReplicateKey) accessibleVideoProviders.add('replicate');

  const allowedVideoSet = new Set(resolveIncludedVideoModels(autoConfig));
  for (const model of videoModels) {
    const provider = getVideoModelProvider(model.modelId);
    if (provider && (
      (provider === 'fal' && userHasFalKey) ||
      (provider === 'minimax' && userHasMiniMaxKey) ||
      (provider === 'hera' && userHasHeraKey) ||
      (provider === 'replicate' && userHasReplicateKey)
    )) {
      allowedVideoSet.add(model.modelId);
    }
  }
  const filteredVideoModels = videoModels.filter((model) => {
    const provider = getVideoModelProvider(model.modelId);
    return !!provider && accessibleVideoProviders.has(provider) && allowedVideoSet.has(model.modelId);
  });

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
