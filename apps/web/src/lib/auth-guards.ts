import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
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

/**
 * Returns a 403 response if the user is currently suspended.
 * Call this in write-path API routes (create, comment, interact, fork).
 * Returns null if the user is not suspended.
 */
export function checkSuspension(session: Session): NextResponse | null {
  const suspendedUntil = session.user.suspendedUntil;
  if (!suspendedUntil) return null;

  const suspendedDate = new Date(suspendedUntil);
  if (suspendedDate <= new Date()) return null;

  return NextResponse.json(
    {
      error: 'Your account is suspended.',
      suspendedUntil: suspendedDate.toISOString(),
    },
    { status: 403 }
  );
}
