import { prisma } from './prisma';

export type MusicGateReason = 'ok' | 'no_music_provider';

export interface MusicGateResult {
  allowed: boolean;
  reason: MusicGateReason;
  hasByokKey: boolean;
}

export interface MusicGenerationStatus {
  available: boolean;
  hasByokKey: boolean;
}

/**
 * Check whether the user has a BYOK key for music generation.
 */
async function hasMusicByokKey(userId: string): Promise<boolean> {
  const key = await prisma.userTtsKey.findFirst({
    where: {
      userId,
      provider: { in: ['suno', 'elevenlabs'] },
      isValid: true,
    },
    select: { id: true },
  });
  return !!key;
}

/**
 * Check whether a music provider is available (platform or BYOK).
 */
async function hasMusicProvider(userId: string): Promise<boolean> {
  if (process.env.SUNO_API_KEY || process.env.ELEVENLABS_API_KEY) return true;
  return hasMusicByokKey(userId);
}

export async function checkMusicGenerationGate(userId: string): Promise<MusicGateResult> {
  const [hasByokKey, providerAvailable] = await Promise.all([
    hasMusicByokKey(userId),
    hasMusicProvider(userId),
  ]);

  return {
    allowed: providerAvailable,
    reason: providerAvailable ? 'ok' : 'no_music_provider',
    hasByokKey,
  };
}

export async function getMusicGenerationStatus(userId: string): Promise<MusicGenerationStatus> {
  const [hasByokKey, available] = await Promise.all([
    hasMusicByokKey(userId),
    hasMusicProvider(userId),
  ]);
  return { available, hasByokKey };
}

export async function tryIncrementMusicGeneration(_userId: string): Promise<boolean> {
  return true;
}
