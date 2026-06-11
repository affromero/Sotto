import { auth } from './auth';

/**
 * Checks admin role from session (no DB re-query).
 * Works during impersonation because session.user.role stays ADMIN.
 * Returns the admin's effective user ID, or null if not admin.
 */
export async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (session.user.role !== 'ADMIN') return null;
  return session.user.id;
}
