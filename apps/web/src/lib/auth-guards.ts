import { auth } from './auth';

/**
 * Checks the admin role from the session. The single self-hosted user is always
 * the owner (ADMIN). Returns the user ID, or null if not admin.
 */
export async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (session.user.role !== 'ADMIN') return null;
  return session.user.id;
}
