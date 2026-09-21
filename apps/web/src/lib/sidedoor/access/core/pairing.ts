import { AccessError, AccessService, tokenHash } from 'thesidedoor-core/access';
import type { Prisma } from '@/generated/prisma/client';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { resolveSottoSession } from '@/lib/sidedoor/access/core/session-identity';
import {
  resolveSottoDevice,
  sottoDeviceService,
} from '@/lib/sidedoor/access/state/device-identity';

/** Callers commit the shared pairing state and application records together. */
export async function issueSottoPairing(
  database: Prisma.TransactionClient,
  sessionToken: string,
  name: string,
  delegation: { scopes?: readonly string[]; defaultProfileId?: string } = {}
) {
  const identity = await resolveSottoSession(database, sessionToken);
  if (identity.kind !== 'content')
    throw new AccessError('forbidden', 'Choose a household profile first');
  if (
    delegation.defaultProfileId !== undefined &&
    (identity.principalId !== null || delegation.defaultProfileId !== identity.userId)
  )
    throw new AccessError('forbidden');
  const scopes = delegation.scopes ?? (identity.isOwner ? ['app', 'owner'] : ['app']);
  if (!scopes.includes('app')) throw new AccessError('invalid', 'Sotto devices require app access');
  const access = new AccessService({ store: await sottoAccessStore(database) });
  const token = await sottoDeviceService(access).issuePairing(
    sessionToken,
    scopes,
    name,
    identity.principalId === null ? { defaultProfileId: identity.userId } : {}
  );
  const pair = (await access.store.read()).tokens.find(
    (item) => item.id === tokenHash(token) && item.kind === 'pair'
  );
  if (!pair) throw new AccessError('conflict');
  return { token, expiresAt: new Date(pair.expiresAt) };
}

export async function redeemSottoPairing(database: Prisma.TransactionClient, code: string) {
  const access = new AccessService({ store: await sottoAccessStore(database) });
  const token = await sottoDeviceService(access).redeemPairing(code);
  const identity = await resolveSottoDevice(database, token, null);
  const device = await sottoDeviceService(access).authenticate(token, ['app']);
  const expiresAt = device.expiresAt === null ? null : new Date(device.expiresAt);
  if (expiresAt && !Number.isFinite(expiresAt.getTime())) throw new AccessError('invalid');
  await database.apiKey.create({
    data: {
      userId: identity.userId,
      name: device.name,
      keyHash: tokenHash(token),
      keyPrefix: `${token.slice(0, 16)}...`,
      expiresAt,
    },
    select: { id: true },
  });
  const user = await database.user.findUniqueOrThrow({
    where: { id: identity.userId },
    select: { id: true, name: true, email: true, image: true },
  });
  return {
    token,
    user: { ...user, role: identity.isOwner ? ('ADMIN' as const) : ('USER' as const) },
  };
}

/** Direct owner key creation uses the same quota, expiry and metadata transaction as pairing. */
export async function createSottoKey(
  database: Prisma.TransactionClient,
  sessionToken: string,
  name: string
) {
  const identity = await resolveSottoSession(database, sessionToken);
  if (!identity.isOwner) throw new AccessError('forbidden');
  const pair = await issueSottoPairing(database, sessionToken, name);
  const redeemed = await redeemSottoPairing(database, pair.token);
  const metadata = await database.apiKey.findUniqueOrThrow({
    where: { keyHash: tokenHash(redeemed.token) },
    select: { id: true, name: true, keyPrefix: true, createdAt: true, expiresAt: true },
  });
  return { ...metadata, key: redeemed.token };
}
