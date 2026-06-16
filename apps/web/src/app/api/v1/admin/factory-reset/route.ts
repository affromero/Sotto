import { NextRequest, NextResponse } from 'next/server';
import { factoryReset } from '@/lib/admin/factory-reset';
import { errorResponse } from '@/lib/api-response';
import { requireAdmin } from '@/lib/auth-guards';
import { ACTIVE_PROFILE_COOKIE } from '@/lib/local-user';
import { logger } from '@/lib/logger';
import { invalidateServerInfra } from '@/lib/server-config';
import { THEME_PREFS_COOKIE } from '@/lib/theme-prefs';
import { factoryResetSchema } from '@/lib/validations';

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return errorResponse('Forbidden', 403);
  }

  const body = await request.json().catch(() => null);
  const parsed = factoryResetSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('You must send { "confirm": "DELETE EVERYTHING" } to factory reset', 400);
  }

  try {
    const result = await factoryReset();
    invalidateServerInfra();

    const response = NextResponse.json({
      success: true,
      redirectTo: '/welcome?reset=1',
      ...result,
    });
    response.cookies.delete(ACTIVE_PROFILE_COOKIE);
    response.cookies.delete(THEME_PREFS_COOKIE);
    return response;
  } catch (error) {
    logger.error('Factory reset failed', {
      adminId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Factory reset failed', 500);
  }
}
