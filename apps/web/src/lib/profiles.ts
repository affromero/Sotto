import { AccessError } from 'thesidedoor-core/access';
import type { Prisma } from '@/generated/prisma/client';
import { prismaUnfiltered } from './prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoAccessStore } from '@/lib/sidedoor/access/core/access-store';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { resolveProfileAvatar } from './avatars';
import type { UserRole } from '@/generated/prisma/client';

/**
 * A household profile as the picker and avatar menu need it: identity, the
 * on-brand animal avatar, and a one-line "what they're learning" summary derived
 * from their most recently touched course. No secrets, no per-user keys.
 */
export interface HouseholdProfile {
  id: string;
  name: string;
  avatarUrl: string;
  isOwner: boolean;
  role: UserRole;
  courseCount: number;
  /** Most recently active course, or null for a brand-new profile. */
  primaryCourse: { targetLang: string; level: string } | null;
}

export async function getHouseholdProfiles(
  request: Request
): Promise<(HouseholdProfile & { isActive: boolean })[]> {
  return sottoTransaction(prismaUnfiltered, (database) => listHouseholdProfiles(database, request));
}

/** Profile visibility follows shared admission, independently of content selection. */
export async function listHouseholdProfiles(
  database: Prisma.TransactionClient,
  request: Request
): Promise<(HouseholdProfile & { isActive: boolean })[]> {
  const identity = await resolveSottoRequest(database, request);
  if (!identity) throw new AccessError('unauthorized');
  const state = await (await sottoAccessStore(database)).read();
  const ids = identity.principalId
    ? [identity.principalId]
    : (state.householdProfiles ?? []).map((profile) => profile.id);
  const users = await database.user.findMany({
    where: { id: { in: ids } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      image: true,
      courses: {
        select: { targetLang: true, currentLevel: true },
        orderBy: { updatedAt: 'desc' },
      },
    },
  });

  return users
    .map((u) => {
      const primary = u.courses[0] ?? null;
      return {
        id: u.id,
        name: u.name ?? 'Learner',
        avatarUrl: resolveProfileAvatar(u.id, u.image).image,
        isOwner: identity.isOwner && u.id === identity.principalId,
        role:
          identity.isOwner && u.id === identity.principalId
            ? ('ADMIN' as const)
            : ('USER' as const),
        isActive: u.id === identity.userId,
        courseCount: u.courses.length,
        primaryCourse: primary
          ? { targetLang: primary.targetLang, level: primary.currentLevel }
          : null,
      };
    })
    .sort((a, b) => (a.isOwner ? -1 : b.isOwner ? 1 : 0));
}
