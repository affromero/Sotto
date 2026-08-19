import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { getActivityData } from '@/lib/activity/heatmap';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/activity — the learner's daily activity heatmap and streaks, the
 * same data the learn hub renders server-side. Exposed for API clients (the
 * iOS app), which cannot read a React server component.
 */
export async function GET(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);

  try {
    const activity = await getActivityData(authed.userId);
    // `days` is a Map, which JSON.stringify would render as {}.
    return NextResponse.json({ ...activity, days: Object.fromEntries(activity.days) });
  } catch (error: unknown) {
    logger.error('Failed to load activity data', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to load activity data', 500);
  }
}
