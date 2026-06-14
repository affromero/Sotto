import { auth } from './auth';
import { prisma } from './prisma';

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

/**
 * Checks admin role for a specific authenticated user via a DB lookup. Use this
 * when the principal comes from authenticateRequest() (a Bearer API key): the
 * session-based requireAdmin() reads the ambient owner and would ignore which
 * key actually authenticated the request.
 */
export async function isUserAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user?.role === 'ADMIN';
}
