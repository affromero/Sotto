import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';

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
