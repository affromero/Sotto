import { AccessError, AccessService } from 'thesidedoor-core/access';
import { cookieValue } from 'thesidedoor-core/access/http';
import type { Prisma } from '@/generated/prisma/client';
import type { ApiKeyData } from '@/types/api-key';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { sottoDeviceService } from '@/lib/sidedoor/access/state/device-identity';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';

/** Retained history is visible only to its credential owner or the instance owner. */
export async function listSottoKeys(database: Prisma.TransactionClient, request: Request) {
  const identity = await resolveSottoRequest(database, request);
  if (!identity || identity.kind !== 'content') throw new AccessError('unauthorized');
  const access = new AccessService({ store: await sottoAccessStore(database) });
  const state = await access.store.read();
  const devices = sottoDeviceService(access);
  const visible = state.deviceTokens
    .filter(
      (device) =>
        identity.authentication === 'session' && device.issuerSessionId === identity.sessionId
    )
    .map((device) => device.id);
  const rows = await database.apiKey.findMany({
    where: identity.isOwner
      ? {}
      : identity.authentication === 'device'
        ? { keyHash: identity.deviceId }
        : identity.principalId
          ? { userId: identity.principalId }
          : { keyHash: { in: visible } },
    orderBy: { createdAt: 'desc' },
  });
  const now = access.now();
  return rows.flatMap((row) => {
    const canonical = state.deviceTokens.find((device) => device.id === row.keyHash);
    if (
      !identity.isOwner &&
      identity.authentication === 'session' &&
      identity.principalId &&
      canonical &&
      canonical.principalId !== identity.principalId
    )
      return [];
    const storedExpiry = row.expiresAt?.getTime() ?? null;
    const canonicalExpiry = canonical?.expiresAt ?? null;
    const expiries = [storedExpiry, canonicalExpiry].filter(
      (value): value is number => value !== null
    );
    const expiresAt = expiries.length ? new Date(Math.min(...expiries)) : null;
    const mismatch =
      canonical !== undefined && storedExpiry !== null && storedExpiry !== canonicalExpiry;
    const status: ApiKeyData['status'] = row.revokedAt
      ? 'revoked'
      : expiresAt && expiresAt.getTime() <= now
        ? 'expired'
        : mismatch
          ? 'unavailable'
          : devices.statusFromState(state, row.keyHash, ['app']);
    return [
      {
        id: row.id,
        name: row.name,
        keyPrefix: row.keyPrefix,
        lastUsedAt: row.lastUsedAt,
        createdAt: row.createdAt,
        revokedAt: row.revokedAt,
        expiresAt,
        status,
      },
    ];
  });
}

/** Revoke canonical authority and retained app metadata in the caller's transaction. */
export async function revokeSottoKey(
  database: Prisma.TransactionClient,
  request: Request,
  id: string
): Promise<boolean> {
  const identity = await resolveSottoRequest(database, request);
  if (!identity || identity.kind !== 'content') throw new AccessError('unauthorized');
  const metadata = await database.apiKey.findUnique({ where: { id } });
  if (!metadata) return false;
  const access = new AccessService({ store: await sottoAccessStore(database) });
  const devices = sottoDeviceService(access);
  const exists = (await access.store.read()).deviceTokens.some(
    (device) => device.id === metadata.keyHash
  );
  if (exists) {
    if (identity.authentication === 'device') {
      await devices.revokeForDevice(
        request.headers.get('authorization')!.slice(7),
        metadata.keyHash
      );
    } else {
      await devices.revoke(cookieValue(request, SHARED_SESSION_COOKIE)!, metadata.keyHash);
    }
  } else if (
    !identity.isOwner &&
    (identity.authentication !== 'session' || identity.principalId !== metadata.userId)
  ) {
    throw new AccessError('forbidden');
  }
  await database.apiKey.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return true;
}
