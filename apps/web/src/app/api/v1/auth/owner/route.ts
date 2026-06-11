import { NextRequest, NextResponse } from 'next/server';
import { isLocalAuthEnabled } from '@/lib/local-auth';
import { createOwner, OwnerExistsError } from '@/lib/local-account';
import { createOwnerSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/owner
 * Create the first owner (ADMIN) on a self-hosted instance. Public, because the
 * very first user has no session yet, but it only works when local auth is on and
 * zero accounts exist (the create-owner first run). Sets ADMIN explicitly (the
 * OAuth bootstrap does not run on this path) and refuses a second owner. The
 * client signs in with the returned id and the password.
 */
export async function POST(request: NextRequest) {
  try {
    if (!(await isLocalAuthEnabled())) {
      return errorResponse('Local sign-in is not enabled', 403);
    }

    const allowed = await checkRateLimit('create-owner', 5, 300);
    if (!allowed) return errorResponse('Too many requests', 429);

    const parsed = createOwnerSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse(parsed.error.errors[0].message, 400);

    const { id } = await createOwner(parsed.data);
    return NextResponse.json({ userId: id }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof OwnerExistsError) {
      return errorResponse('An owner already exists', 403);
    }
    logger.error('Failed to create owner', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to create owner', 500);
  }
}
