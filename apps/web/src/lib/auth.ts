import { cache } from 'react';
import { cookies } from 'next/headers';
import type { UserRole } from '@/generated/prisma/client';
import { prisma } from './prisma';
import { LOCAL_USER_ID, ensureLocalUser } from './local-user';

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: UserRole;
}

export interface AuthSession {
  user: AuthUser;
}

/**
 * Sotto is fully self-hosted for a single learner — there is no login. Every
 * request resolves to one implicit local user, which is always the owner
 * (ADMIN). The result is memoized per request via React `cache()`.
 *
 * The signature stays `Promise<AuthSession | null>` so existing route guards
 * (`if (!session?.user?.id) return 401`) keep compiling and the tests that mock
 * this to `null` keep passing; at runtime the local user is always present.
 */
export const auth = cache(async (): Promise<AuthSession | null> => {
  // Touch a request-scoped API so every page/route that resolves the current
  // user opts out of static prerendering (these are per-instance data pages,
  // never static) — the same effect NextAuth's session-cookie read used to have,
  // and what keeps the production build from querying Prisma with no database.
  await cookies();
  let user = await prisma.user.findUnique({ where: { id: LOCAL_USER_ID } });
  if (!user) user = await ensureLocalUser();
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: 'ADMIN',
    },
  };
});
