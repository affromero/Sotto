import { cache } from 'react';
import { cookies } from 'next/headers';
import { isAccessError } from 'thesidedoor-core/access';
import type { UserRole } from '@/generated/prisma/client';
import { prismaUnfiltered } from './prisma';
import {
  resolveSottoSession,
  SHARED_SESSION_COOKIE,
} from '@/lib/sidedoor/access/core/session-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: UserRole;
}

export interface AuthSession {
  user: AuthUser;
  principalId: string | null;
  sessionId: string;
  isOwner: boolean;
}

/** Request-local content identity. Household profile selection never grants owner authority. */
export async function resolveSession(): Promise<AuthSession | null> {
  const token = (await cookies()).get(SHARED_SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await sottoTransaction(prismaUnfiltered, async (database) => {
      const identity = await resolveSottoSession(database, token);
      if (identity.kind !== 'content') return null;
      const user = await database.user.findUniqueOrThrow({
        where: { id: identity.userId },
        select: { id: true, name: true, email: true, image: true },
      });
      return {
        user: { ...user, role: identity.isOwner ? 'ADMIN' : 'USER' },
        principalId: identity.principalId,
        sessionId: identity.sessionId,
        isOwner: identity.isOwner,
      };
    });
  } catch (error) {
    if (isAccessError(error) && (error.code === 'unauthorized' || error.code === 'forbidden'))
      return null;
    throw error;
  }
}

export const auth = cache(resolveSession);
