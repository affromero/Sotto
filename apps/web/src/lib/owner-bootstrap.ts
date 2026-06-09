import { prisma } from './prisma';
import { hasConfiguredAdminEmails } from './admin-emails';

/**
 * First-user-becomes-owner bootstrap.
 *
 * On a self-host with no configured `ADMIN_EMAILS`, the first account created is
 * the household owner and is promoted to `ADMIN`. Hosted deployments configure
 * `ADMIN_EMAILS` and rely on that path instead (this is a no-op there).
 *
 * Idempotent: only promotes when no other `ADMIN` already exists, so it never
 * grants ownership once a household owner is established.
 *
 * @returns true if this call promoted the user to owner, false otherwise.
 */
export async function bootstrapFirstUserAsOwner(userId: string): Promise<boolean> {
  if (hasConfiguredAdminEmails()) return false;

  const otherAdmins = await prisma.user.count({
    where: { role: 'ADMIN', id: { not: userId } },
  });
  if (otherAdmins > 0) return false;

  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
  return true;
}
