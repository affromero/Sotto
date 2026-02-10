import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { logger } from './logger';
import { prisma } from './prisma';
import {
  type TtsProviderId,
  validateProviderCredentials,
  getProviderMeta,
} from './providers/tts-registry';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

function getEncryptionKey(salt: Buffer): Buffer {
  const secret = process.env.BYOK_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('BYOK_ENCRYPTION_KEY environment variable is not set');
  }
  return scryptSync(secret, salt, KEY_LENGTH);
}

/**
 * Encrypt an API key for storage.
 * Format: base64(salt + iv + authTag + ciphertext)
 */
export function encryptApiKey(plaintext: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = getEncryptionKey(salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([salt, iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt a stored API key.
 */
export function decryptApiKey(encoded: string): string {
  const combined = Buffer.from(encoded, 'base64');

  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = getEncryptionKey(salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

// ---------------------------------------------------------------------------
// Multi-provider BYOK operations (UserTtsKey model)
// ---------------------------------------------------------------------------

export interface ByokCredentials {
  apiKey: string;
  userId?: string; // PlayHT requires this
}

export interface ByokKeyInfo {
  provider: TtsProviderId;
  isValid: boolean;
  lastUsedAt: Date | null;
  label: string | null;
}

/**
 * Store (upsert) a BYOK key for a specific provider.
 */
export async function storeByokKey(
  userId: string,
  provider: TtsProviderId,
  credentials: ByokCredentials
): Promise<void> {
  const encryptedKey = encryptApiKey(credentials.apiKey);
  const encryptedExtra = credentials.userId
    ? encryptApiKey(JSON.stringify({ userId: credentials.userId }))
    : null;

  await prisma.userTtsKey.upsert({
    where: { userId_provider: { userId, provider } },
    update: {
      encryptedKey,
      extraData: encryptedExtra,
      isValid: true,
      updatedAt: new Date(),
    },
    create: {
      userId,
      provider,
      encryptedKey,
      extraData: encryptedExtra,
      isValid: true,
      label: getProviderMeta(provider).displayName,
    },
  });

  logger.info('Stored BYOK key', { userId, provider });
}

/**
 * Retrieve and decrypt a user's BYOK key for a specific provider.
 * Returns null if the user has no key for that provider.
 */
export async function getByokKey(userId: string, provider?: TtsProviderId): Promise<string | null> {
  // Legacy: no provider arg → query elevenlabs (backward compat)
  const targetProvider = provider ?? 'elevenlabs';

  const record = await prisma.userTtsKey.findUnique({
    where: { userId_provider: { userId, provider: targetProvider } },
  });

  if (!record) {
    // Fallback: check legacy column for elevenlabs
    if (targetProvider === 'elevenlabs') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { elevenLabsApiKey: true },
      });
      if (!user?.elevenLabsApiKey) return null;
      try {
        return decryptApiKey(user.elevenLabsApiKey);
      } catch (error) {
        logger.error('Failed to decrypt legacy BYOK key', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }
    return null;
  }

  try {
    // Update lastUsedAt
    await prisma.userTtsKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });
    return decryptApiKey(record.encryptedKey);
  } catch (error) {
    logger.error('Failed to decrypt BYOK key', {
      userId,
      provider: targetProvider,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Retrieve the extra credentials (e.g. PlayHT userId) for a provider.
 */
export async function getByokExtraData(
  userId: string,
  provider: TtsProviderId
): Promise<Record<string, string> | null> {
  const record = await prisma.userTtsKey.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { extraData: true },
  });

  if (!record?.extraData) return null;

  try {
    return JSON.parse(decryptApiKey(record.extraData));
  } catch {
    return null;
  }
}

/**
 * Remove a user's BYOK key for a specific provider.
 */
export async function removeByokKey(userId: string, provider?: TtsProviderId): Promise<void> {
  const targetProvider = provider ?? 'elevenlabs';

  await prisma.userTtsKey
    .delete({
      where: { userId_provider: { userId, provider: targetProvider } },
    })
    .catch(() => {
      // Ignore if doesn't exist
    });

  // Also clear legacy column for elevenlabs
  if (targetProvider === 'elevenlabs') {
    await prisma.user.update({
      where: { id: userId },
      data: { elevenLabsApiKey: null },
    });
  }

  logger.info('Removed BYOK key', { userId, provider: targetProvider });
}

/**
 * List all configured BYOK providers for a user.
 */
export async function listByokProviders(userId: string): Promise<ByokKeyInfo[]> {
  const keys = await prisma.userTtsKey.findMany({
    where: { userId },
    select: {
      provider: true,
      isValid: true,
      lastUsedAt: true,
      label: true,
    },
  });

  return keys.map((k) => ({
    provider: k.provider as TtsProviderId,
    isValid: k.isValid,
    lastUsedAt: k.lastUsedAt,
    label: k.label,
  }));
}

/**
 * Check if a user has any BYOK key configured.
 */
export async function hasByokKey(userId: string, provider?: TtsProviderId): Promise<boolean> {
  if (provider) {
    const count = await prisma.userTtsKey.count({
      where: { userId, provider },
    });
    return count > 0;
  }

  // Any provider
  const count = await prisma.userTtsKey.count({ where: { userId } });
  if (count > 0) return true;

  // Legacy fallback
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { elevenLabsApiKey: true },
  });
  return !!user?.elevenLabsApiKey;
}

/**
 * Validate a BYOK key against the provider's API.
 */
export async function validateByokKey(
  provider: TtsProviderId,
  credentials: ByokCredentials
): Promise<boolean> {
  const creds: Record<string, string> = { apiKey: credentials.apiKey };
  if (credentials.userId) creds.userId = credentials.userId;
  return validateProviderCredentials(provider, creds);
}

// Legacy exports for backward compat
export { validateProviderCredentials as validateElevenLabsKey };
