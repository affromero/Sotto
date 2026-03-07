import { NextRequest, NextResponse } from 'next/server';
import { hasByokKey } from '@/lib/byok';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { fetchFalImageModels, fetchAllVideoModels } from '@/lib/video-cost-estimator';

/**
 * GET — Returns available image and video models with live pricetoken pricing.
 * Image models are FAL-only; video models span all providers (FAL + MiniMax).
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return errorResponse('Unauthorized', 401);

  const [imageModels, videoModels, hasFalKey, hasMiniMaxKey] = await Promise.all([
    fetchFalImageModels(),
    fetchAllVideoModels(),
    hasByokKey(auth.userId, 'fal'),
    hasByokKey(auth.userId, 'minimax'),
  ]);

  return NextResponse.json({
    imageModels: imageModels.map((m) => ({
      modelId: m.modelId,
      displayName: m.displayName,
      pricePerImage: m.pricePerImage,
      defaultResolution: m.defaultResolution,
      qualityTier: m.qualityTier,
    })),
    videoModels: videoModels.map((m) => ({
      modelId: m.modelId,
      displayName: m.displayName,
      costPerMinute: m.costPerMinute,
      resolution: m.resolution,
      maxDuration: m.maxDuration,
      qualityMode: m.qualityMode,
    })),
    hasFalKey,
    hasMiniMaxKey,
  });
}
