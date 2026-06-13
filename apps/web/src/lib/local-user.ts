import { prisma } from './prisma';

/**
 * Sotto is fully self-hosted for a single learner. There is no login: every
 * request resolves to this one implicit local user, which is always the owner.
 */
export const LOCAL_USER_ID = 'local-user';

/**
 * Idempotently ensure the single local user row exists. Safe to call on every
 * request — `auth()` reads first and only upserts when the row is missing
 * (i.e. on a fresh install). `email`/`handle` are unique placeholders the
 * learner can change from settings.
 */
export async function ensureLocalUser() {
  return prisma.user.upsert({
    where: { id: LOCAL_USER_ID },
    update: {},
    create: {
      id: LOCAL_USER_ID,
      email: 'learner@localhost',
      name: 'Learner',
      handle: 'learner',
      role: 'ADMIN',
    },
  });
}
