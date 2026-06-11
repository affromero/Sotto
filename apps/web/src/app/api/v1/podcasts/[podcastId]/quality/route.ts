import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
/**
 * GET /api/podcasts/[podcastId]/quality
 * Returns computed quality score from PodcastFeature.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ podcastId: string }> }
) {
  const { podcastId } = await params;

  const feature = await prisma.podcastFeature.findUnique({
    where: { podcastId },
    select: {
      avgCompletionRate: true,
      medianCompletionRate: true,
      totalUniqueListeners: true,
      totalListenMinutes: true,
      saveToListenRatio: true,
      interactionRate: true,
      relistenRate: true,
      avgListenSpeed: true,
      speedDistribution: true,
      abandonmentCurve: true,
      segmentAbandonRates: true,
      computedAt: true,
    },
  });

  if (!feature) {
    return errorResponse('No quality data available yet', 404);
  }

  // Compute composite quality score
  const qualityScore = Math.min(
    (feature.avgCompletionRate / 100) * 0.45 +
      feature.saveToListenRatio * 0.25 +
      feature.interactionRate * 0.1 +
      feature.relistenRate * 0.2,
    1
  );

  return NextResponse.json({
    qualityScore: Math.round(qualityScore * 100) / 100,
    ...feature,
  });
}
