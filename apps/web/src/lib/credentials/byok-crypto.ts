import { scryptSync } from 'crypto';

const KEY_LENGTH = 32;

function getEncryptionKey(salt: Buffer): Buffer {
  const secret = process.env.BYOK_ENCRYPTION_KEY;
  if (!secret) throw new Error('BYOK_ENCRYPTION_KEY environment variable is not set');
  return scryptSync(secret, salt, KEY_LENGTH);
}

/** Derive the application key used by Sidedoor-owned credentials. */
export function deriveOwnedCredentialKey(): Buffer {
  return getEncryptionKey(Buffer.from('sotto-owned-credentials-v1', 'utf8'));
}
