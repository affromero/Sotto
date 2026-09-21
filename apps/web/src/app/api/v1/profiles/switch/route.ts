import { NextRequest, NextResponse } from 'next/server';
import { readAccessJson } from 'thesidedoor-core/access/http';
import { prismaUnfiltered } from '@/lib/prisma';
import { switchProfileSchema } from '@/lib/validations';
import { THEME_PREFS_COOKIE, serializeThemePrefs, themePrefsFromUser } from '@/lib/theme-prefs';
import { errorResponse } from '@/lib/api-response';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { selectSottoProfile } from '@/lib/sidedoor/access/core/profiles';

export async function POST(request: NextRequest) {
  const browser = !request.headers.has('authorization');
  return accessOperation(request, browser, async () => {
    const parsed = switchProfileSchema.safeParse(await readAccessJson(request));
    if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);
    const target = await sottoTransaction(prismaUnfiltered, (database) =>
      selectSottoProfile(database, request, parsed.data.profileId)
    );
    if (!target) return errorResponse('Profile not found', 404);
    const response = NextResponse.json({ ok: true, profileId: target.id });
    response.cookies.delete('sotto_profile');
    if (browser)
      response.cookies.set(THEME_PREFS_COOKIE, serializeThemePrefs(themePrefsFromUser(target)), {
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        secure: process.env.NODE_ENV === 'production',
      });
    return response;
  });
}

export async function DELETE(request: NextRequest) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    await sottoTransaction(prismaUnfiltered, (database) =>
      selectSottoProfile(database, request, null)
    );
    const response = NextResponse.json({ ok: true });
    response.cookies.delete('sotto_profile');
    response.cookies.delete(THEME_PREFS_COOKIE);
    return response;
  });
}
