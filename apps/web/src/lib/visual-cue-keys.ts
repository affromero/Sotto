import { decryptApiKey, encryptApiKey } from './byok';
import { logger } from './logger';
import { prisma } from './prisma';

export type VisualCueProviderId = 'pexels';

const VISUAL_CUE_PROVIDER_LABEL: Record<VisualCueProviderId, string> = {
  pexels: 'Pexels',
};

export interface VisualCueKeyInfo {
  provider: VisualCueProviderId;
  isValid: boolean;
  lastUsedAt: Date | null;
  label: string | null;
}

export function isValidVisualCueProviderId(provider: string): provider is VisualCueProviderId {
  return provider === 'pexels';
}

export async function validateVisualCueKey(
  provider: VisualCueProviderId,
  apiKey: string,
): Promise<boolean> {
  if (provider !== 'pexels') return false;
  try {
    const url = new URL('https://api.pexels.com/v1/search');
    url.searchParams.set('query', 'language learning');
    url.searchParams.set('per_page', '1');
    const response = await fetch(url, {
      headers: { Authorization: apiKey },
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function storeVisualCueKey(
  userId: string,
  provider: VisualCueProviderId,
  apiKey: string,
): Promise<void> {
  const encryptedKey = encryptApiKey(apiKey);
  await prisma.userVisualCueKey.upsert({
    where: { userId_provider: { userId, provider } },
    update: { encryptedKey, isValid: true, updatedAt: new Date() },
    create: {
      userId,
      provider,
      encryptedKey,
      isValid: true,
      label: VISUAL_CUE_PROVIDER_LABEL[provider],
    },
  });
  logger.info('Stored visual cue provider key', { userId, provider });
}

export async function getVisualCueKey(
  userId: string,
  provider: VisualCueProviderId,
): Promise<string | null> {
  const record = await prisma.userVisualCueKey.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!record || !record.isValid) return null;

  try {
    await prisma.userVisualCueKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });
    return decryptApiKey(record.encryptedKey);
  } catch (error) {
    logger.error('Failed to decrypt visual cue provider key', {
      userId,
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function listVisualCueKeys(userId: string): Promise<VisualCueKeyInfo[]> {
  const keys = await prisma.userVisualCueKey.findMany({
    where: { userId },
    select: {
      provider: true,
      isValid: true,
      lastUsedAt: true,
      label: true,
    },
  });

  return keys.flatMap((key) => {
    if (!isValidVisualCueProviderId(key.provider)) return [];
    return [{
      provider: key.provider,
      isValid: key.isValid,
      lastUsedAt: key.lastUsedAt,
      label: key.label,
    }];
  });
}

export async function removeVisualCueKey(
  userId: string,
  provider: VisualCueProviderId,
): Promise<void> {
  await prisma.userVisualCueKey
    .delete({
      where: { userId_provider: { userId, provider } },
    })
    .catch(() => undefined);
  logger.info('Removed visual cue provider key', { userId, provider });
}
