import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { ACTIVE_PROFILE_COOKIE } from '@/lib/local-user';
import { switchProfileSchema } from '@/lib/validations';
import { THEME_PREFS_COOKIE, serializeThemePrefs, themePrefsFromUser } from '@/lib/theme-prefs';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Switch the active household profile by setting the `sotto_profile` cookie.
 * Passwordless by design: any visitor to this trusted local instance may pick a
 * profile, exactly like a shared TV. The cookie is the only place a profile is
 * "set" — `auth()` only ever reads it.
 */
export async function POST(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);

    const body = await request.json();
    const validation = switchProfileSchema.safeParse(body);
    if (!validation.success) {
      return errorResponse(validation.error.issues[0].message, 400);
    }

    const target = await prisma.user.findUnique({
      where: { id: validation.data.profileId },
      select: {
        id: true,
        themeMode: true,
        themePalette: true,
        themeAccent: true,
        reducedMotion: true,
      },
    });
    if (!target) return errorResponse('Profile not found', 404);

    const response = NextResponse.json({ ok: true, profileId: target.id });
    response.cookies.set(ACTIVE_PROFILE_COOKIE, target.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: ONE_YEAR_SECONDS,
      secure: process.env.NODE_ENV === 'production',
    });
    // Seed the readable appearance cookie so the picked profile's theme applies
    // before first paint on the next navigation.
    response.cookies.set(THEME_PREFS_COOKIE, serializeThemePrefs(themePrefsFromUser(target)), {
      sameSite: 'lax',
      path: '/',
      maxAge: ONE_YEAR_SECONDS,
      secure: process.env.NODE_ENV === 'production',
    });
    return response;
  } catch (error: unknown) {
    logger.error('Failed to switch profile', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to switch profile', 500);
  }
}

/**
 * Exit the currently selected household profile. This does not revoke API keys,
 * delete data, or sign out of a server account; it only clears the local active
 * profile cookie so the next app load returns to the household picker.
 */
export async function DELETE(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);

    const response = NextResponse.json({ ok: true });
    response.cookies.delete(ACTIVE_PROFILE_COOKIE);
    response.cookies.delete(THEME_PREFS_COOKIE);
    return response;
  } catch (error: unknown) {
    logger.error('Failed to exit profile', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to exit profile', 500);
  }
}
