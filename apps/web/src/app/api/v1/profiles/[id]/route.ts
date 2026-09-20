import { cookieValue, readAccessJson } from 'thesidedoor-core/access/http';
import { isStorageManifestLimitError } from 'thesidedoor-core/storage';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { prepareSottoProfileUpdate, updateSottoProfile } from '@/lib/sidedoor/access/core/profiles';
import { NextRequest, NextResponse } from 'next/server';
import { prismaUnfiltered } from '@/lib/prisma';
import { ACTIVE_PROFILE_COOKIE } from '@/lib/profiles/profile-cookie';
import { updateProfileSchema } from '@/lib/validations';
import { errorResponse } from '@/lib/api-response';
import { deleteSottoProfile } from '@/lib/sidedoor/access/deletion/profile-deletion';
import { THEME_PREFS_COOKIE } from '@/lib/theme-prefs';

type RouteParams = { params: Promise<{ id: string }> };

/** Update display metadata without changing the account login name. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    const { id } = await params;
    const parsed = updateProfileSchema.safeParse(await readAccessJson(request));
    if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);
    const prepared = prepareSottoProfileUpdate(id, parsed.data.name);
    const user = await sottoTransaction(prismaUnfiltered, (database) =>
      updateSottoProfile(database, request, prepared, parsed.data.avatarSlug)
    );
    return NextResponse.json(user);
  });
}

/** Remove learner data and queue durable cleanup under canonical household authority. */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    const { id } = await params;
    const cleanup = await deleteSottoProfile(prismaUnfiltered, request, id).catch(
      (error: unknown) => {
        if (isStorageManifestLimitError(error)) return 'oversized' as const;
        throw error;
      }
    );
    if (cleanup === 'oversized')
      return errorResponse(
        'A stored file reference is too large to snapshot. The profile was not deleted.',
        413
      );
    if (!cleanup) return errorResponse('Profile not found', 404);
    const response = NextResponse.json(
      { success: true, cleanup: { id: cleanup.id, phase: cleanup.phase } },
      { status: 202 }
    );
    if (cleanup.clearSelection || cookieValue(request, ACTIVE_PROFILE_COOKIE) === id) {
      response.cookies.delete(ACTIVE_PROFILE_COOKIE);
      response.cookies.delete(THEME_PREFS_COOKIE);
    }
    return response;
  });
}
