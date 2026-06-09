import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isLocalAuthEnabled } from '@/lib/local-auth';
import { getAnimalAvatar } from '@/lib/avatars';
import { checkRateLimit } from '@/lib/redis';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/profiles
 * The household roster for the Netflix-style sign-in picker. Returns only
 * non-secret fields (id, name, image, a derived emoji, and an admin flag). Lists
 * only accounts that have a local password. Empty when local auth is off.
 */
export async function GET() {
  try {
    if (!(await isLocalAuthEnabled())) {
      return NextResponse.json({ localAuth: false, profiles: [] });
    }

    // Light rate limit so the roster cannot be scraped aggressively.
    const allowed = await checkRateLimit('auth-profiles', 60, 60);
    if (!allowed) return errorResponse('Too many requests', 429);

    const users = await prisma.user.findMany({
      where: { passwordHash: { not: null } },
      select: { id: true, name: true, image: true, role: true },
      orderBy: { createdAt: 'asc' },
    });

    const profiles = users.map((u) => {
      const slug =
        u.image && u.image.startsWith('/avatars/')
          ? u.image.slice('/avatars/'.length).replace(/\.png$/, '')
          : null;
      const animal = slug ? getAnimalAvatar(slug) : undefined;
      return {
        id: u.id,
        name: u.name,
        image: u.image,
        emoji: animal?.emoji ?? null,
        isAdmin: u.role === 'ADMIN',
      };
    });

    return NextResponse.json({ localAuth: true, profiles });
  } catch (error: unknown) {
    logger.error('Failed to list profiles', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to load profiles', 500);
  }
}
