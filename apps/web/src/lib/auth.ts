import { cache } from 'react';
import { cookies } from 'next/headers';
import type { UserRole } from '@/generated/prisma/client';
import { prisma } from './prisma';
import { LOCAL_USER_ID, ACTIVE_PROFILE_COOKIE, ensureLocalUser } from './local-user';

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
 * Resolve the current request's profile. Sotto is self-hosted for a household
 * with no login: the active profile is whichever one the `sotto_profile` cookie
 * points at, set by the passwordless picker. With no (or a stale) cookie we fall
 * back to the owner, so a fresh install and a single-profile household behave
 * exactly as before. The resolved role is the profile's real DB role — the owner
 * is ADMIN, learners added later are USER — which is what gates the admin area.
 *
 * Exported (un-memoized) for unit tests; request code should use `auth()`, which
 * memoizes this per request via React `cache()`. Cookies are only ever READ
 * here; switching profiles sets the cookie from the switch route handler.
 *
 * The signature stays `Promise<AuthSession | null>` so existing route guards
 * (`if (!session?.user?.id) return 401`) keep compiling and tests that mock this
 * to `null` keep passing; at runtime a profile is always present.
 */
export async function resolveSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const activeId = cookieStore.get(ACTIVE_PROFILE_COOKIE)?.value;

  let user = activeId
    ? await prisma.user.findUnique({ where: { id: activeId } })
    : null;
  if (!user) user = await prisma.user.findUnique({ where: { id: LOCAL_USER_ID } });
  if (!user) user = await ensureLocalUser();

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
    },
  };
}

export const auth = cache(resolveSession);
