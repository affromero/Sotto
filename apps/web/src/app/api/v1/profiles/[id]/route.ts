import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { LOCAL_USER_ID, ACTIVE_PROFILE_COOKIE } from '@/lib/local-user';
import { avatarImagePath, resolveProfileAvatar } from '@/lib/avatars';
import { updateProfileSchema } from '@/lib/validations';
import { deleteFile, listFiles } from '@/lib/r2';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

type RouteParams = { params: Promise<{ id: string }> };

/** Rename a profile and/or set its preset animal avatar. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);

    const { id } = await params;
    const body = await request.json();
    const validation = updateProfileSchema.safeParse(body);
    if (!validation.success) {
      return errorResponse(validation.error.issues[0].message, 400);
    }

    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return errorResponse('Profile not found', 404);

    const data: { name?: string; image?: string | null } = {};
    if (validation.data.name !== undefined) data.name = validation.data.name;
    if (validation.data.avatarSlug !== undefined) {
      data.image = avatarImagePath(validation.data.avatarSlug);
    }

    const user = await prisma.user.update({ where: { id }, data });
    return NextResponse.json({
      id: user.id,
      name: user.name,
      avatarUrl: resolveProfileAvatar(user.id, user.image).image,
      isOwner: user.id === LOCAL_USER_ID,
      role: user.role,
    });
  } catch (error: unknown) {
    logger.error('Failed to update profile', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to update profile', 500);
  }
}

/** Remove a profile and all its data. The owner and the last profile are protected. */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);

    const { id } = await params;
    if (id === LOCAL_USER_ID) {
      return errorResponse('The owner profile cannot be deleted', 400);
    }

    const profile = await prisma.user.findUnique({
      where: { id },
      select: { id: true, image: true },
    });
    if (!profile) return errorResponse('Profile not found', 404);

    const total = await prisma.user.count();
    if (total <= 1) return errorResponse('Cannot delete the last profile', 400);

    // Collect episode prefixes before the cascade removes the rows.
    const episodes = await prisma.episode.findMany({
      where: { userId: id },
      select: { id: true },
    });

    // Cascade deletes every per-profile record (courses, vocab graph, keys, ...).
    await prisma.user.delete({ where: { id } });

    // Best-effort storage cleanup — never fails the request.
    try {
      const deletions: Promise<void>[] = [];
      for (const ep of episodes) {
        const keys = await listFiles(`episodes/${ep.id}/`);
        // force: true — deleting a whole profile is a legitimate bulk-delete.
        for (const key of keys) deletions.push(deleteFile(key, { force: true }));
      }
      // Only an uploaded avatar lives in storage; preset /avatars/*.png are bundled.
      if (profile.image && !profile.image.startsWith('/avatars/')) {
        deletions.push(deleteFile(profile.image));
      }
      if (deletions.length > 0) await Promise.allSettled(deletions);
    } catch (storageError) {
      logger.error('Profile deletion storage cleanup failed', {
        id,
        error: storageError instanceof Error ? storageError.message : 'Unknown error',
      });
    }

    const response = NextResponse.json({ success: true });
    // If the deleted profile was the active one, drop the cookie so the next
    // request falls back to the owner instead of a now-dead id.
    const cookieStore = await cookies();
    if (cookieStore.get(ACTIVE_PROFILE_COOKIE)?.value === id) {
      response.cookies.delete(ACTIVE_PROFILE_COOKIE);
    }
    return response;
  } catch (error: unknown) {
    logger.error('Failed to delete profile', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to delete profile', 500);
  }
}
