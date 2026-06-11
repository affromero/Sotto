import { prisma } from './prisma';

export type VideoGateReason = 'ok' | 'no_image_provider';

export interface VideoGateResult {
  allowed: boolean;
  reason: VideoGateReason;
  hasByokKey: boolean;
}

export interface VideoGenerationStatus {
  available: boolean;
  hasByokKey: boolean;
}

/**
 * Check whether the user has a BYOK key for image/video/avatar generation.
 */
async function hasImageByokKey(userId: string): Promise<boolean> {
  const key = await prisma.userTtsKey.findFirst({
    where: {
      userId,
      provider: { in: ['fal', 'minimax', 'heygen', 'runway'] },
      isValid: true,
    },
    select: { id: true },
  });
  return !!key;
}

/**
 * Check whether an image/video/avatar provider is available (platform or BYOK).
 */
async function hasImageProvider(userId: string): Promise<boolean> {
  if (process.env.FAL_KEY || process.env.MINIMAX_API_KEY || process.env.HEYGEN_API_KEY || process.env.RUNWAY_API_KEY) {
    return true;
  }
  return hasImageByokKey(userId);
}

export async function checkVideoGenerationGate(userId: string): Promise<VideoGateResult> {
  const [hasByokKey, providerAvailable] = await Promise.all([
    hasImageByokKey(userId),
    hasImageProvider(userId),
  ]);

  return {
    allowed: providerAvailable,
    reason: providerAvailable ? 'ok' : 'no_image_provider',
    hasByokKey,
  };
}

export async function checkAvatarGenerationGate(userId: string): Promise<VideoGateResult> {
  return checkVideoGenerationGate(userId);
}

export async function tryIncrementVideoGeneration(_userId: string): Promise<boolean> {
  return true;
}

export async function tryIncrementAvatarGeneration(_userId: string): Promise<boolean> {
  return true;
}

export async function getAvatarGenerationStatus(userId: string): Promise<VideoGenerationStatus> {
  const [hasByokKey, available] = await Promise.all([
    hasImageByokKey(userId),
    hasImageProvider(userId),
  ]);
  return { available, hasByokKey };
}

export async function getVideoGenerationStatus(userId: string): Promise<VideoGenerationStatus> {
  return getAvatarGenerationStatus(userId);
}
