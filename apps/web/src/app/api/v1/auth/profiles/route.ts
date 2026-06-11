import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isLocalAuthEnabled } from '@/lib/local-auth';
import { resolveProfileAvatar } from '@/lib/avatars';
import { checkRateLimit } from '@/lib/redis';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/profiles
 * The household roster for the Netflix-style sign-in picker. Returns only
 * non-secret fields (id, name, image, a derived emoji, an admin flag, and a
 * derived hasPassword so the picker knows who taps straight in). Lists local
 * accounts that have a password plus intentional passwordless members; OAuth-only
 * accounts are excluded. Empty when local auth is off.
 */
export async function GET() {
  try {
    if (!(await isLocalAuthEnabled())) {
      return NextResponse.json({ localAuth: false, profiles: [] });
    }

    // Light rate limit so the roster cannot be scraped aggressively.
    const allowed = await checkRateLimit('auth-profiles', 60, 60);
    if (!allowed) return errorResponse('Too many requests', 429);

    // First run: local auth is on and the instance has no accounts at all, so the
    // visitor should create the owner rather than pick a profile.
    const totalUsers = await prisma.user.count();
    if (totalUsers === 0) {
      return NextResponse.json({ localAuth: true, needsOwner: true, profiles: [] });
    }

    const users = await prisma.user.findMany({
      where: { OR: [{ passwordHash: { not: null } }, { passwordless: true }] },
      select: { id: true, name: true, image: true, role: true, passwordHash: true },
      orderBy: { createdAt: 'asc' },
    });

    const profiles = users.map((u) => {
      // Always resolve to a repo animal: an explicitly chosen one, otherwise a
      // deterministic animal for this id. Offline-safe, never a generic avatar.
      const { image, emoji } = resolveProfileAvatar(u.id, u.image);
      return {
        id: u.id,
        name: u.name,
        image,
        emoji,
        isAdmin: u.role === 'ADMIN',
        // Derived only; the hash itself never leaves the server.
        hasPassword: u.passwordHash !== null,
      };
    });

    return NextResponse.json({ localAuth: true, needsOwner: false, profiles });
  } catch (error: unknown) {
    logger.error('Failed to list profiles', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to load profiles', 500);
  }
}
