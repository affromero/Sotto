import { auth } from './auth';
import type { AuthenticatedRequest } from './api-keys';

/**
 * Returns the shared owner's learner ID for browser-only administration.
 */
export async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!session.isOwner) return null;
  return session.user.id;
}

/**
 * Authority belongs to the authenticated credential, including delegated device scope.
 */
export function isUserAdmin(identity: AuthenticatedRequest): boolean {
  return identity.isOwner;
}
