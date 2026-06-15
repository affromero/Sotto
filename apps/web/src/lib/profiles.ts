import { prisma } from './prisma';
import { LOCAL_USER_ID } from './local-user';
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

/** Every profile in the household, owner first, each with its course summary. */
export async function getHouseholdProfiles(): Promise<HouseholdProfile[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
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
        isOwner: u.id === LOCAL_USER_ID,
        role: u.role,
        courseCount: u.courses.length,
        primaryCourse: primary
          ? { targetLang: primary.targetLang, level: primary.currentLevel }
          : null,
      };
    })
    .sort((a, b) => (a.isOwner ? -1 : b.isOwner ? 1 : 0));
}
