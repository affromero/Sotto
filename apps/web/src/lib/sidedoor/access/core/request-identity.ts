import { AccessError, isAccessError } from 'thesidedoor-core/access';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { cookieValue } from 'thesidedoor-core/access/http';
import type { Prisma } from '@/generated/prisma/client';
import {
  resolveSottoSession,
  SHARED_SESSION_COOKIE,
  type SottoSessionIdentity,
} from '@/lib/sidedoor/access/core/session-identity';
import {
  resolveSottoDevice,
  type SottoDeviceIdentity,
} from '@/lib/sidedoor/access/state/device-identity';

export type SottoRequestIdentity =
  | (SottoSessionIdentity & { authentication: 'session'; deviceId: null })
  | (SottoDeviceIdentity & { kind: 'content'; authentication: 'device'; sessionId: null });

/** Revalidate the original credential and selected content identity in the caller's transaction. */
export async function requireOriginalSottoAdmission(
  database: Prisma.TransactionClient,
  request: Request,
  expected: AuthenticatedRequest
) {
  const current = await resolveSottoRequest(database, request);
  if (!current || current.kind !== 'content') throw new AccessError('unauthorized');
  if (
    current.userId !== expected.userId ||
    current.principalId !== expected.principalId ||
    current.authentication !== expected.authentication ||
    current.sessionId !== expected.sessionId ||
    current.deviceId !== expected.deviceId ||
    current.isOwner !== expected.isOwner
  )
    throw new AccessError('conflict', 'The active identity changed during this operation');
}

/** A supplied Authorization header is exclusive. It never falls back to browser cookies. */
export async function resolveSottoRequest(
  database: Prisma.TransactionClient,
  request: Request
): Promise<SottoRequestIdentity | null> {
  try {
    const authorization = request.headers.get('authorization');
    if (authorization !== null) {
      const match = /^Bearer ([^\s,]+)$/i.exec(authorization);
      if (!match?.[1]) return null;
      const identity = await resolveSottoDevice(
        database,
        match[1],
        request.headers.get('x-sotto-profile-id')
      );
      return { ...identity, kind: 'content', authentication: 'device', sessionId: null };
    }
    const token = cookieValue(request, SHARED_SESSION_COOKIE);
    if (!token) return null;
    const identity = await resolveSottoSession(database, token);
    return { ...identity, authentication: 'session', deviceId: null };
  } catch (error) {
    if (isAccessError(error) && ['unauthorized', 'forbidden', 'invalid'].includes(error.code))
      return null;
    throw error;
  }
}
