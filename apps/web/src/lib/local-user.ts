import crypto from 'crypto';
import { prisma } from './prisma';
import { avatarImagePath } from './avatars';

/**
 * Sotto is self-hosted for a household of learners. There is no login: the
 * active profile is chosen from a passwordless picker and remembered in the
 * `sotto_profile` cookie. The very first profile — created on a fresh install —
 * is the owner (ADMIN); every profile added afterwards is a regular learner.
 */
export const LOCAL_USER_ID = 'local-user';

/** Cookie holding the active profile's user id. Read by `auth()`. */
export const ACTIVE_PROFILE_COOKIE = 'sotto_profile';

/**
 * Idempotently ensure the owner profile exists. Safe to call on every request —
 * `auth()` reads first and only upserts when the row is missing (i.e. on a fresh
 * install). `email` is a unique placeholder the learner can change from settings.
 * The owner is always ADMIN.
 */
export async function ensureLocalUser() {
  return prisma.user.upsert({
    where: { id: LOCAL_USER_ID },
    update: {},
    create: {
      id: LOCAL_USER_ID,
      email: 'learner@localhost',
      name: 'Learner',
      role: 'ADMIN',
    },
  });
}

/**
 * The owner row can exist before first-run setup is finished. Treat the
 * instance as onboarded only after the final welcome save marks the owner done.
 */
export async function hasCompletedInitialOnboarding(): Promise<boolean> {
  const owner = await prisma.user.findUnique({
    where: { id: LOCAL_USER_ID },
    select: { hasCompletedOnboarding: true },
  });

  return owner?.hasCompletedOnboarding ?? false;
}

/**
 * Create an additional household profile (a regular learner, never the owner).
 * The placeholder email is unique per profile so it satisfies `User.email`'s
 * unique constraint; the learner renames it from settings. An optional preset
 * animal avatar slug seeds the profile's picture.
 */
export async function createProfile({
  name,
  avatarSlug,
}: {
  name: string;
  avatarSlug?: string | null;
}) {
  return prisma.user.create({
    data: {
      email: `profile-${crypto.randomUUID()}@localhost`,
      name,
      role: 'USER',
      image: avatarSlug ? avatarImagePath(avatarSlug) : null,
      hasCompletedOnboarding: false,
    },
  });
}

/** Every profile in the household, owner first then by creation order. */
export async function listProfiles() {
  const profiles = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  return profiles.sort((a, b) => (a.id === LOCAL_USER_ID ? -1 : b.id === LOCAL_USER_ID ? 1 : 0));
}
