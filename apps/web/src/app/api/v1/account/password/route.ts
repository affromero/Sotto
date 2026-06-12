import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { changeOwnPassword, InvalidPasswordError } from '@/lib/local-account';
import { changePasswordSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/account/password
 * Self-service password change. Verifies the current password, then sets the new
 * one and clears the force-change flag. Keeps the user's current session valid.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return errorResponse('Unauthorized', 401);

  const allowed = await checkRateLimit(`pw-change:${session.user.id}`, 10, 300);
  if (!allowed) return errorResponse('Too many requests', 429);

  const parsed = changePasswordSchema.safeParse(await request.json());
  if (!parsed.success) return errorResponse(parsed.error.issues[0].message, 400);

  try {
    await changeOwnPassword({ userId: session.user.id, ...parsed.data });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof InvalidPasswordError) {
      return errorResponse('Current password is incorrect', 403);
    }
    logger.error('Failed to change password', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to change password', 500);
  }
}
