import { prisma } from './prisma';

export type VideoGateReason = 'ok' | 'no_image_provider';

export interface VideoGateResult {
  allowed: boolean;
  reason: VideoGateReason;
}

/**
 * Check if a user can generate video.
 * Any user is allowed if a video/image provider key is available (BYOK or platform).
 */
export async function checkVideoGenerationGate(userId: string): Promise<VideoGateResult> {
  // Check platform keys first (cheapest check)
  if (process.env.FAL_KEY || process.env.MINIMAX_API_KEY) {
    return { allowed: true, reason: 'ok' };
  }

  // Check for any BYOK key that supports video/image generation
  const byokKey = await prisma.userTtsKey.findFirst({
    where: {
      userId,
      provider: { in: ['fal', 'minimax', 'heygen'] },
      isValid: true,
    },
    select: { id: true },
  });

  if (byokKey) {
    return { allowed: true, reason: 'ok' };
  }

  return { allowed: false, reason: 'no_image_provider' };
}
