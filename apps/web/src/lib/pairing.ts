import crypto from 'crypto';
import { prisma } from './prisma';

/** Pairing tokens are short-lived by design — the QR only needs to live for a scan. */
const PAIRING_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface IssuedPairingToken {
  token: string;
  expiresAt: Date;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Issue a short-lived, single-use pairing token for a user. Only the hash is
 * persisted; the raw token is returned once (it goes into the QR) and never stored.
 */
export async function createPairingToken(userId: string, name?: string): Promise<IssuedPairingToken> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  await prisma.pairingToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ...(name ? { name } : {}),
    },
  });
  return { token, expiresAt };
}

/**
 * Redeem a pairing token. Returns the owning user (+ the device name) on success,
 * or null for any failure (unknown / expired / already used). Single-use is
 * enforced atomically: the `updateMany` only claims a row whose `usedAt` is still
 * null, so two simultaneous redemptions can never both succeed.
 */
export async function redeemPairingToken(
  token: string,
): Promise<{ userId: string; name: string } | null> {
  const row = await prisma.pairingToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  const claimed = await prisma.pairingToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;

  return { userId: row.userId, name: row.name };
}
