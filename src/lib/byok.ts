import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { logger } from './logger';
import { prisma } from './prisma';

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

/**
 * Validate an ElevenLabs API key by calling their user endpoint.
 */
export async function validateElevenLabsKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': apiKey },
    });
    return response.ok;
  } catch (error) {
    logger.warn('Failed to validate ElevenLabs API key', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Store an encrypted ElevenLabs API key for a user.
 */
export async function storeByokKey(userId: string, apiKey: string): Promise<void> {
  const encrypted = encryptApiKey(apiKey);
  await prisma.user.update({
    where: { id: userId },
    data: { elevenLabsApiKey: encrypted },
  });
  logger.info('Stored BYOK key for user', { userId });
}

/**
 * Retrieve and decrypt a user's ElevenLabs API key.
 * Returns null if user has no BYOK key.
 */
export async function getByokKey(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { elevenLabsApiKey: true },
  });

  if (!user?.elevenLabsApiKey) return null;

  try {
    return decryptApiKey(user.elevenLabsApiKey);
  } catch (error) {
    logger.error('Failed to decrypt BYOK key', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Remove a user's BYOK key.
 */
export async function removeByokKey(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { elevenLabsApiKey: null },
  });
  logger.info('Removed BYOK key for user', { userId });
}

/**
 * Check if a user has a BYOK key configured.
 */
export async function hasByokKey(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { elevenLabsApiKey: true },
  });
  return !!user?.elevenLabsApiKey;
}
