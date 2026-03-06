import { NextRequest, NextResponse } from 'next/server';
import { STATIC_IMAGE_PRICING, STATIC_VIDEO_PRICING } from 'pricetoken';
import { hasByokKey } from '@/lib/byok';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { getFalImageEndpoint, getFalVideoEndpoint } from '@/lib/providers/fal-endpoints';

/**
 * GET — Returns available Fal image and video models with pricetoken pricing.
 * Models are only shown if they have a known Fal endpoint mapping.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return errorResponse('Unauthorized', 401);

  const imageModels = STATIC_IMAGE_PRICING
    .filter((m) => m.provider === 'fal' && getFalImageEndpoint(m.modelId))
    .map((m) => ({
      modelId: m.modelId,
      displayName: m.displayName,
      pricePerImage: m.pricePerImage,
      defaultResolution: m.defaultResolution,
      qualityTier: m.qualityTier,
    }));

  const videoModels = STATIC_VIDEO_PRICING
    .filter((m) => m.provider === 'fal' && getFalVideoEndpoint(m.modelId))
    .map((m) => ({
      modelId: m.modelId,
      displayName: m.displayName,
      costPerMinute: m.costPerMinute,
      resolution: m.resolution,
      maxDuration: m.maxDuration,
      qualityMode: m.qualityMode,
    }));

  const hasFalKey = await hasByokKey(auth.userId, 'fal');

  return NextResponse.json({ imageModels, videoModels, hasFalKey });
}
