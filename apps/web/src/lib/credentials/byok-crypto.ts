import { createHash, scryptSync } from 'crypto';

const KEY_LENGTH = 32;
let cachedKey: { secretFingerprint: string; value: Buffer } | undefined;

function clearCachedKey(): void {
  cachedKey?.value.fill(0);
  cachedKey = undefined;
}

/** Reuse only the current instance key. Credential ownership is checked by the caller. */
export function deriveOwnedCredentialKey(): Buffer {
  const secret = process.env.BYOK_ENCRYPTION_KEY;
  if (!secret) {
    clearCachedKey();
    throw new Error('BYOK_ENCRYPTION_KEY environment variable is not set');
  }

  const secretFingerprint = createHash('sha256').update(secret).digest('hex');
  if (cachedKey?.secretFingerprint !== secretFingerprint) {
    clearCachedKey();
    const value = scryptSync(secret, Buffer.from('sotto-owned-credentials-v1', 'utf8'), KEY_LENGTH);
    cachedKey = { secretFingerprint, value };
  }
  return Buffer.from(cachedKey.value);
}
