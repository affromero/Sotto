import { tokenHash } from 'thesidedoor-core/access';
import { cookieValue } from 'thesidedoor-core/access/http';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import { prismaUnfiltered } from './prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import {
  resolveSottoRequest,
  type SottoRequestIdentity,
} from '@/lib/sidedoor/access/core/request-identity';

export type AuthenticatedRequest = Extract<SottoRequestIdentity, { kind: 'content' }>;

export async function validateApiKey(key: string): Promise<AuthenticatedRequest | null> {
  return authenticateRequest(
    new Request('http://localhost', {
      headers: { authorization: `Bearer ${key}` },
    })
  );
}

/** Browser and native requests share one authority snapshot and profile policy. */
export async function authenticateRequest(request: Request): Promise<AuthenticatedRequest | null> {
  if (!request.headers.has('authorization') && !cookieValue(request, SHARED_SESSION_COOKIE))
    return null;
  return sottoTransaction(prismaUnfiltered, async (database) => {
    const identity = await resolveSottoRequest(database, request);
    if (!identity || identity.kind !== 'content') return null;
    if (identity.authentication === 'device') {
      const authorization = request.headers.get('authorization')!;
      const token = /^Bearer ([^\s,]+)$/i.exec(authorization)![1]!;
      const now = new Date();
      await database.apiKey.updateMany({
        where: {
          keyHash: tokenHash(token),
          revokedAt: null,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - 60_000) } }],
        },
        data: { lastUsedAt: now },
      });
    }
    return identity;
  });
}
